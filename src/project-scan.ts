// プロジェクトモード: ソースと xcprivacy をファイルシステム上で歩く（比較用）。
// Xcode プロジェクトの本格パースはしない。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseOpenStep, type PlistValue } from "plist";
import { walk, isXcprivacyName } from "./fswalk.ts";
import { judge } from "./bundle-scan.ts";
import { parseManifestFile } from "./manifest.ts";
import { sourceMatchers, findSymbols, recordHit } from "./symbols.ts";
import type { BundleReport, Issue, ManifestInfo, SymbolHit } from "./types.ts";

const SOURCE_EXT = new Set([".swift", ".m", ".mm", ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp"]);
const SKIP_DIRS = new Set([".git", "node_modules", "DerivedData", "build", ".build", ".swiftpm"]);

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

/**
 * ユニット（ターゲットに相当しそうな単位）の根:
 * - スキャンのルート
 * - Package.swift / *.podspec / *.xcodeproj を含むディレクトリ
 * - Package.swift のある場所の Sources/<Target>/（SwiftPM のターゲット）
 * ソースとマニフェストは、それぞれ最も近いユニット根に属する。
 */
function isUnitRoot(dir: string, root: string): boolean {
  if (dir === root) return true;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  if (names.some((n) => n === "Package.swift" || n.endsWith(".podspec") || n.endsWith(".xcodeproj"))) return true;
  const parent = dirname(dir);
  return basename(parent) === "Sources" && existsSync(join(dirname(parent), "Package.swift"));
}

export function scanProject(root: string, display: (p: string) => string): { bundles: BundleReport[]; manifests: string[]; issues: Issue[] } {
  const { dirs, files } = walk(root, (name) => SKIP_DIRS.has(name) || name.endsWith(".xcodeproj") || name.endsWith(".xcworkspace"));
  const unitDirs = dirs.filter((d) => isUnitRoot(d, root));
  const unitOf = (f: string): string => {
    let d = dirname(f);
    while (true) {
      if (unitDirs.includes(d)) return d;
      if (d === root || d === dirname(d)) return root;
      d = dirname(d);
    }
  };

  interface Unit {
    manifests: string[];
    sources: string[];
  }
  const units = new Map<string, Unit>(unitDirs.map((d) => [d, { manifests: [], sources: [] }]));
  const manifests: string[] = [];
  for (const f of files) {
    const name = basename(f);
    if (isXcprivacyName(name)) {
      manifests.push(f);
      units.get(unitOf(f))!.manifests.push(f);
    } else if (SOURCE_EXT.has(ext(name))) {
      units.get(unitOf(f))!.sources.push(f);
    }
  }

  const issues: Issue[] = [];

  // 重複 1: 同じディレクトリに *.xcprivacy が 2 つ以上（大文字小文字違い・別名を含む）
  const byDir = new Map<string, string[]>();
  for (const m of manifests) byDir.set(dirname(m), [...(byDir.get(dirname(m)) ?? []), m]);
  for (const [dir, list] of byDir) {
    if (list.length > 1) {
      issues.push({
        type: "duplicate_manifest",
        severity: "error",
        target: display(dir),
        message: `${display(dir)} に xcprivacy が ${list.length} 個あります（同じターゲットにコピーされると衝突します）: ${list.map((f) => basename(f)).join(", ")}`,
        files: list.map(display),
      });
    }
  }
  // 重複 2: project.pbxproj の Copy Bundle Resources（解析できる範囲）
  issues.push(...pbxprojDuplicates(root, display));

  const matchers = sourceMatchers();
  const bundles: BundleReport[] = [];
  for (const [dir, unit] of units) {
    if (dir !== root && unit.manifests.length === 0 && unit.sources.length === 0) continue;
    const target = display(dir);
    const infos: ManifestInfo[] = [];
    const declared = new Set<string>();
    for (const m of unit.manifests) {
      const parsed = parseManifestFile(m, display(m));
      for (const i of parsed.issues) issues.push({ ...i, target });
      infos.push({ path: display(m), role: "root", ok: parsed.ok, declared: parsed.declared, ...(parsed.error ? { error: parsed.error } : {}) });
      for (const d of parsed.declared) declared.add(d.category);
    }
    const hitMap = new Map<string, SymbolHit>();
    for (const src of unit.sources) {
      const lines = readFileSync(src, "utf8").split(/\r?\n/);
      lines.forEach((line, idx) => {
        for (const m of findSymbols(line, matchers)) {
          recordHit(hitMap, m.symbol, "confirmed", "source", `${display(src)}:${idx + 1}`);
        }
      });
    }
    const hits = [...hitMap.values()];
    const main = dir === root;
    // ルート以外で記号も無くマニフェストも無いユニットは問題にしない
    if (!main && unit.manifests.length === 0 && hits.length === 0) continue;
    issues.push(...judge(target, main, unit.manifests.length > 0, hits, declared, "project-unit"));
    bundles.push({
      path: target,
      kind: "project-unit",
      main,
      manifests: infos,
      binaries: [],
      hits,
      declaredCategories: [...declared].sort(),
    });
  }
  return { bundles, manifests: manifests.map(display), issues };
}

type Obj = Record<string, PlistValue>;
const asObj = (v: unknown): Obj | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : undefined;

/** *.xcodeproj/project.pbxproj から、ターゲットごとの Resources フェーズにある xcprivacy を数える */
export function pbxprojDuplicates(root: string, display: (p: string) => string): Issue[] {
  const issues: Issue[] = [];
  const { dirs } = walk(root, (name) => SKIP_DIRS.has(name));
  for (const d of dirs) {
    if (!d.endsWith(".xcodeproj")) continue;
    const pbx = join(d, "project.pbxproj");
    if (!existsSync(pbx)) continue;
    let objects: Obj | undefined;
    try {
      objects = asObj(asObj(parseOpenStep(readFileSync(pbx, "utf8")))?.["objects"]);
    } catch {
      continue; // 解析できなければ諦める（ファイルシステム側の重複検出は別途行う）
    }
    if (!objects) continue;
    for (const obj of Object.values(objects)) {
      const t = asObj(obj);
      if (!t || (t["isa"] !== "PBXNativeTarget" && t["isa"] !== "PBXAggregateTarget")) continue;
      const names: string[] = [];
      for (const phaseId of (t["buildPhases"] as PlistValue[] | undefined) ?? []) {
        const phase = asObj(objects[String(phaseId)]);
        if (!phase || phase["isa"] !== "PBXResourcesBuildPhase") continue;
        for (const bfId of (phase["files"] as PlistValue[] | undefined) ?? []) {
          const bf = asObj(objects[String(bfId)]);
          const ref = asObj(objects[String(bf?.["fileRef"])]);
          const p = String(ref?.["path"] ?? ref?.["name"] ?? "");
          if (isXcprivacyName(basename(p))) names.push(p);
        }
      }
      if (names.length > 1) {
        const tname = String(t["name"] ?? "?");
        issues.push({
          type: "duplicate_manifest",
          severity: "error",
          target: `${display(d)}#${tname}`,
          message: `${display(d)} のターゲット ${tname} の Copy Bundle Resources に xcprivacy が ${names.length} 個あります: ${names.join(", ")}`,
          files: names,
        });
      }
    }
  }
  return issues;
}

