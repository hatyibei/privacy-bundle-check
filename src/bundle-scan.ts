// 成果物（.app / .xcarchive / ゆるいバンドル根）のスキャン。
import { basename, dirname, extname, relative, sep } from "node:path";
import { walk, isXcprivacyName } from "./fswalk.ts";
import { parseManifestFile } from "./manifest.ts";
import { CATALOG, categoriesForSymbol, firstUndeclaredCategory, isSymbolSatisfied, shortName } from "./required-reason-apis.ts";
import { extractObjcMethnamesFromFile } from "./macho.ts";
import { hasMachOMagic, nmOf, parseNmUndefined, stringsOf, type Tools } from "./strings.ts";
import { binaryMatchers, collectBinaryHits } from "./symbols.ts";
import type { BundleReport, Issue, ManifestInfo, SymbolHit } from "./types.ts";
import type { Root } from "./discover.ts";

const CODE_BUNDLE_EXT: Record<string, BundleReport["kind"]> = {
  ".app": "app",
  ".framework": "framework",
  ".appex": "appex",
  ".xctest": "xctest",
};

/** バンドル根からみて「マニフェストを置く場所」とみなすディレクトリ */
function isManifestHomeRel(rel: string): boolean {
  const parts = rel === "" ? [] : rel.split(sep);
  if (parts.length === 0) return true; // 直下（iOS）
  if (parts.length === 1 && parts[0] === "Resources") return true;
  if (parts.length === 2 && parts[0] === "Contents" && parts[1] === "Resources") return true; // macOS .app
  if (parts.length === 3 && parts[0] === "Versions" && parts[2] === "Resources") return true; // macOS framework
  return false;
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

function nearest(path: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  for (const c of candidates) if (isInside(path, c) && (!best || c.length > best.length)) best = c;
  return best;
}

interface InternalBundle {
  dir: string;
  kind: BundleReport["kind"];
  main: boolean;
  rootManifests: string[];
  resourceManifests: Map<string, string[]>; // .bundle dir → manifests
  misplaced: string[];
  binaries: string[];
}

export function scanBundleRoot(root: Root, display: (p: string) => string, tools: Tools): { bundles: BundleReport[]; manifests: string[]; issues: Issue[] } {
  const { dirs, files } = walk(root.dir);
  const codeBundles: InternalBundle[] = [];
  const resourceBundles: string[] = [];
  for (const d of dirs) {
    const ext = extname(d).toLowerCase();
    const kind = d === root.dir ? (root.kind === "loose" ? "loose" : "app") : CODE_BUNDLE_EXT[ext];
    if (kind) {
      codeBundles.push({
        dir: d,
        kind,
        main: d === root.dir,
        rootManifests: [],
        resourceManifests: new Map(),
        misplaced: [],
        binaries: [],
      });
    } else if (ext === ".bundle") {
      resourceBundles.push(d);
    }
  }
  const byDir = new Map(codeBundles.map((b) => [b.dir, b]));
  const codeDirs = codeBundles.map((b) => b.dir);

  const allManifests: string[] = [];
  for (const f of files) {
    const owner = byDir.get(nearest(f, codeDirs)!)!;
    const name = basename(f);
    if (isXcprivacyName(name)) {
      allManifests.push(f);
      const rb = nearest(f, resourceBundles.filter((r) => isInside(r, owner.dir) && r !== owner.dir));
      if (rb) {
        if (isManifestHomeRel(relative(rb, dirname(f)))) {
          const list = owner.resourceManifests.get(rb) ?? [];
          list.push(f);
          owner.resourceManifests.set(rb, list);
        } else owner.misplaced.push(f);
      } else if (isManifestHomeRel(relative(owner.dir, dirname(f)))) {
        owner.rootManifests.push(f);
      } else {
        owner.misplaced.push(f);
      }
      continue;
    }
    if (isExecutableCandidate(f, owner)) owner.binaries.push(f);
  }

  const matchers = binaryMatchers();
  const issues: Issue[] = [];
  const reports: BundleReport[] = [];

  for (const b of codeBundles) {
    const target = display(b.dir);
    const manifests: ManifestInfo[] = [];
    const declared = new Set<string>();

    // 重複: 同じバンドル根（Resources 等を含む）に *.xcprivacy が 2 つ以上
    const dupGroups: [string, string[]][] = [[b.dir, b.rootManifests], ...b.resourceManifests];
    for (const [dir, list] of dupGroups) {
      if (list.length > 1) {
        issues.push({
          type: "duplicate_manifest",
          severity: "error",
          target: display(dir),
          message: `${display(dir)} の直下に xcprivacy が ${list.length} 個あります（大文字小文字違い・別名を含む）: ${list.map((f) => basename(f)).join(", ")}`,
          files: list.map(display),
        });
      }
    }

    const addManifest = (f: string, role: ManifestInfo["role"]) => {
      const parsed = parseManifestFile(f, display(f));
      for (const i of parsed.issues) issues.push({ ...i, target });
      manifests.push({ path: display(f), role, ok: parsed.ok, declared: parsed.declared, ...(parsed.error ? { error: parsed.error } : {}) });
      if (role !== "misplaced") for (const d of parsed.declared) declared.add(d.category);
    };
    for (const f of b.rootManifests) addManifest(f, "root");
    for (const list of b.resourceManifests.values()) for (const f of list) addManifest(f, "resource-bundle");
    for (const f of b.misplaced) {
      addManifest(f, "misplaced");
      issues.push({
        type: "misplaced_manifest",
        severity: "warning",
        target,
        message: `${display(f)} はバンドル根（または Resources）直下にないので、このバンドルのマニフェストとして扱いません`,
        files: [display(f)],
      });
    }

    // バイナリスキャン
    const hitMap = new Map<string, SymbolHit>();
    for (const bin of b.binaries) {
      const str = stringsOf(bin, tools);
      const nmText = nmOf(bin, tools);
      collectBinaryHits(hitMap, display(bin), matchers, {
        stringsText: str.text,
        stringsVia: str.via,
        nmUndefinedText: nmText !== null ? parseNmUndefined(nmText).join("\n") : null,
        methnameText: nmText !== null ? extractObjcMethnamesFromFile(bin).join("\n") : "",
      });
    }
    const hits = [...hitMap.values()];
    issues.push(...judge(target, b.main, b.rootManifests.length > 0, hits, declared, b.kind));

    reports.push({
      path: target,
      kind: b.kind,
      main: b.main,
      manifests,
      binaries: b.binaries.map(display),
      hits,
      declaredCategories: [...declared].sort(),
    });
  }
  return { bundles: reports, manifests: allManifests.map(display), issues };
}

function isExecutableCandidate(f: string, owner: InternalBundle): boolean {
  const name = basename(f);
  const bundleName = basename(owner.dir, extname(owner.dir));
  const rel = relative(owner.dir, dirname(f));
  if (name === bundleName) {
    const parts = rel === "" ? [] : rel.split(sep);
    if (parts.length === 0) return true; // Foo.app/Foo, Bar.framework/Bar
    if (parts.length === 2 && parts[0] === "Contents" && parts[1] === "MacOS") return true;
    if (parts.length === 2 && parts[0] === "Versions") return true;
  }
  if (name.toLowerCase().endsWith(".dylib")) return true;
  return hasMachOMagic(f);
}

/** バンドル単位の判定（バンドル / プロジェクト共通） */
export function judge(
  target: string,
  main: boolean,
  hasManifest: boolean,
  hits: SymbolHit[],
  declared: Set<string>,
  kind: BundleReport["kind"],
): Issue[] {
  const issues: Issue[] = [];
  const confirmed = new Map<string, string[]>();
  const weak = new Map<string, string[]>();
  for (const h of hits) {
    const cats = h.categories.length ? h.categories : [h.category];
    const m = h.confidence === "confirmed" ? confirmed : weak;
    for (const c of cats) m.set(c, [...(m.get(c) ?? []), h.symbol]);
  }
  // 確定ヒットのある記号は、同じ記号の参考ヒットを重ねて報告しない
  for (const c of confirmed.keys()) weak.delete(c);

  if (!hasManifest) {
    const cats = [...confirmed.keys()];
    const severity = main || cats.length > 0 ? "error" : "warning";
    const what = kind === "project-unit" ? "ユニット" : "バンドル";
    let message = `${target} に PrivacyInfo.xcprivacy がありません`;
    if (cats.length > 0) message += `（Required Reason API: ${cats.map(shortName).join(", ")}）`;
    else if (weak.size > 0) message += `（参考ヒット: ${[...weak.keys()].map(shortName).join(", ")}）`;
    else if (main) message += `（${kind === "project-unit" ? "プロジェクトのルート" : "アプリ本体"}は記号が無くても必須扱い）`;
    else message += `（記号の無い埋め込み${what}なので warning）`;
    issues.push({
      type: "missing_manifest",
      severity,
      target,
      message,
      symbols: [...confirmed.values(), ...weak.values()].flat(),
    });
    return issues;
  }

  for (const def of CATALOG) {
    const c = def.category;
    const syms = (confirmed.get(c) ?? []).filter(
      (s) => !isSymbolSatisfied(s, declared) && firstUndeclaredCategory(s, declared) === c,
    );
    if (syms.length) {
      const alts = [...new Set(syms.flatMap((s) => categoriesForSymbol(s)))];
      const altText =
        alts.length > 1
          ? `公式ドキュメントでは ${alts.map(shortName).join(" / ")} の両方に載っている記号を含みます。少なくとも一方を理由付きで宣言してください`
          : `マニフェストに理由付きの ${c} がありません`;
      issues.push({
        type: "undeclared_api",
        severity: "error",
        target,
        category: c,
        message: `${target}: ${def.short} の記号 (${[...new Set(syms)].join(", ")}) があるのに、${altText}`,
        symbols: [...new Set(syms)],
      });
      continue;
    }
    const w = (weak.get(c) ?? []).filter(
      (s) => !isSymbolSatisfied(s, declared) && firstUndeclaredCategory(s, declared) === c,
    );
    if (w.length) {
      issues.push({
        type: "possible_undeclared_api",
        severity: "warning",
        target,
        category: c,
        message: `${target}: 参考ヒット (${[...new Set(w)].join(", ")}) のみ。${def.short} が未宣言です（バイナリの \`UserDefaults\` 単体は誤検知があり得るので warning）`,
        symbols: [...new Set(w)],
      });
    }
  }
  return issues;
}

