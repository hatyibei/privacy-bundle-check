// テキスト（strings 出力 / ソース）からカタログ記号を探す。
import { CATALOG, categoriesForSymbol, type Category } from "./required-reason-apis.ts";
import type { Confidence, SymbolHit } from "./types.ts";

export interface Matcher {
  symbol: string;
  category: Category;
  confidence: Confidence;
  re: RegExp;
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * バイナリ用の一致規則:
 * - 前: 英字・`_` の直後ではない。ただし先頭の `_` は何個でも許す（C 記号の `_stat`、`__stat` など）。
 *       数字の直後は許す（Swift マングル名の長さ接頭辞 `12systemUptime` 等）。
 * - 後: 英数字・`_` が続かない（`stat` が `status` や `stat_foo` に当たらない）。
 *       `$` や `@` は区切り扱い（`_stat$INODE64`, `_stat@plt`）。
 * - 例外: Swift マングル名で `<長さ><記号>` の形（長さ = 記号の文字数）なら、後ろに何が続いてもよい。
 */
export function binaryRegex(symbol: string): RegExp {
  const s = esc(symbol);
  const len = symbol.length;
  return new RegExp(
    `(?:(?<![A-Za-z_])_*${s}(?![A-Za-z0-9_]))|(?:(?<![0-9])${len}${s})`,
    "g",
  );
}

/** ソース用: 識別子の単語境界 */
export function sourceRegex(symbol: string): RegExp {
  const s = esc(symbol);
  return new RegExp(`(?<![A-Za-z0-9_])${s}(?![A-Za-z0-9_])`, "g");
}

export function binaryMatchers(): Matcher[] {
  const out: Matcher[] = [];
  for (const c of CATALOG) {
    for (const sym of c.binary)
      out.push({ symbol: sym, category: c.category, confidence: "confirmed", re: binaryRegex(sym) });
    for (const sym of c.binaryWeak)
      out.push({ symbol: sym, category: c.category, confidence: "weak", re: binaryRegex(sym) });
  }
  return out;
}

export function sourceMatchers(): Matcher[] {
  const out: Matcher[] = [];
  for (const c of CATALOG) {
    const syms = new Set([...c.binary, ...c.binaryWeak, ...c.sourceOnly]);
    for (const sym of syms)
      out.push({ symbol: sym, category: c.category, confidence: "confirmed", re: sourceRegex(sym) });
  }
  return out;
}

/** text に当たった記号名の集合を返す */
export function findSymbols(text: string, matchers: Matcher[]): Matcher[] {
  const hits: Matcher[] = [];
  for (const m of matchers) {
    m.re.lastIndex = 0;
    if (m.re.test(text)) hits.push(m);
  }
  return hits;
}

/** Merge a matcher hit into a symbol-keyed map (union categories, keep locations/via). */
export function recordHit(
  map: Map<string, SymbolHit>,
  symbol: string,
  confidence: Confidence,
  via: string,
  location: string,
): void {
  const cats = categoriesForSymbol(symbol);
  const primary = cats[0];
  if (!primary) return;
  const h = map.get(symbol) ?? {
    symbol,
    category: primary,
    categories: [...cats],
    confidence,
    via: [],
    locations: [],
  };
  for (const c of cats) if (!h.categories.includes(c)) h.categories.push(c);
  if (confidence === "confirmed") h.confidence = "confirmed";
  if (!h.via.includes(via)) h.via.push(via);
  if (location && !h.locations.includes(location)) h.locations.push(location);
  map.set(symbol, h);
}
