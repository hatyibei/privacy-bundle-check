import { basename, dirname, extname, relative, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { resolveRoots, InputError } from "./discover.ts";
import { scanBundleRoot } from "./bundle-scan.ts";
import { scanProject } from "./project-scan.ts";
import { detectTools } from "./strings.ts";
import type { BundleReport, Issue, ScanResult } from "./types.ts";

export interface ScanOptions {
  mode: "bundle" | "project";
  /** false なら strings / nm を使わず自前の抽出のみ */
  externalTools: boolean;
}

export function scan(inputPath: string, opts: ScanOptions): ScanResult {
  const input = resolve(inputPath);
  // 表示用: .app / .xcarchive を直接指定されたらその名前から、フォルダならその中からの相対
  const ext = extname(input).toLowerCase();
  const base = ext === ".app" || ext === ".xcarchive" ? dirname(input) : input;
  const display = (p: string) => relative(base, p) || ".";
  const tools = detectTools(opts.externalTools);

  let bundles: BundleReport[] = [];
  let manifests: string[] = [];
  let issues: Issue[] = [];

  if (opts.mode === "project") {
    if (!existsSync(input)) throw new InputError(`パスがありません: ${inputPath}`);
    if (!statSync(input).isDirectory()) throw new InputError(`ディレクトリを指定してください: ${inputPath}`);
    ({ bundles, manifests, issues } = scanProject(input, (p) => relative(input, p) || basename(input)));
  } else {
    for (const root of resolveRoots(input)) {
      const r = scanBundleRoot(root, display, tools);
      bundles.push(...r.bundles);
      manifests.push(...r.manifests);
      issues.push(...r.issues);
    }
  }
  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  return {
    input: inputPath,
    mode: opts.mode,
    tools,
    bundles,
    manifests,
    issues,
    summary: {
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
    },
  };
}
