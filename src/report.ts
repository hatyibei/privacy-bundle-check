import { shortName } from "./required-reason-apis.ts";
import type { ScanResult } from "./types.ts";

export function formatText(r: ScanResult): string {
  const out: string[] = [];
  out.push(`privacy-bundle-check: ${r.input} (mode: ${r.mode})`);
  out.push(`  ツール: strings=${r.tools.strings ? "コマンド" : "内蔵"} nm=${r.tools.nm ?? "なし"}`);
  out.push("");
  out.push(`PrivacyInfo.xcprivacy（${r.manifests.length} 件）:`);
  for (const m of r.manifests) out.push(`  - ${m}`);
  if (r.manifests.length === 0) out.push("  （なし）");
  out.push("");
  out.push(r.mode === "project" ? "ユニット:" : "バンドル:");
  for (const b of r.bundles) {
    out.push(`  [${b.kind}${b.main ? ", 本体" : ""}] ${b.path}`);
    const roots = b.manifests.filter((m) => m.role !== "misplaced");
    out.push(`    マニフェスト: ${roots.length ? roots.map((m) => m.path + (m.role === "resource-bundle" ? " (resource bundle)" : "")).join(", ") : "なし"}`);
    out.push(`    宣言: ${b.declaredCategories.length ? b.declaredCategories.map(shortName).join(", ") : "なし"}`);
    if (r.mode === "bundle") out.push(`    バイナリ: ${b.binaries.length ? b.binaries.join(", ") : "なし"}`);
    for (const h of b.hits) {
      const loc = h.locations.slice(0, 3).join(", ") + (h.locations.length > 3 ? ` 他${h.locations.length - 3}` : "");
      out.push(`    記号: ${h.symbol} → ${shortName(h.category)}${h.confidence === "weak" ? "（参考）" : ""} [${h.via.join("/")}] ${loc}`);
    }
  }
  out.push("");
  if (r.issues.length === 0) {
    out.push("問題なし");
  } else {
    out.push("問題:");
    for (const i of r.issues) out.push(`  ${i.severity === "error" ? "ERROR" : "WARN "} ${i.type}: ${i.message}`);
  }
  out.push("");
  out.push(`error ${r.summary.errors} 件 / warning ${r.summary.warnings} 件`);
  return out.join("\n");
}
