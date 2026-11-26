// バイナリから印字可能文字列を抜く。`strings` / `nm` があれば使い、無ければ自前で抜く。
import { spawnSync } from "node:child_process";
import { openSync, readSync, closeSync, readFileSync } from "node:fs";

export interface Tools {
  strings: boolean;
  nm: string | null;
}

let cached: Tools | undefined;

function hasCommand(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { stdio: "ignore", timeout: 5000 });
  return !r.error;
}

/** 環境の `strings` / `nm` / `llvm-nm` を調べる（`useExternal=false` なら使わない） */
export function detectTools(useExternal: boolean): Tools {
  if (!useExternal) return { strings: false, nm: null };
  if (cached) return cached;
  const strings = hasCommand("strings", ["--version"]);
  let nm: string | null = null;
  for (const c of ["llvm-nm", "nm"]) {
    if (hasCommand(c, ["--version"])) {
      nm = c;
      break;
    }
  }
  cached = { strings, nm };
  return cached;
}

const MIN_LEN = 4;

function utf8SeqLen(buf: Uint8Array, i: number): number {
  const b = buf[i]!;
  let n = 0;
  if (b >= 0xc2 && b <= 0xdf) n = 2;
  else if (b >= 0xe0 && b <= 0xef) n = 3;
  else if (b >= 0xf0 && b <= 0xf4) n = 4;
  else return 0;
  if (i + n > buf.length) return 0;
  for (let k = 1; k < n; k++) {
    const c = buf[i + k]!;
    if (c < 0x80 || c > 0xbf) return 0;
  }
  return n;
}

/**
 * 自前の strings: ASCII 印字可能文字（0x20-0x7e とタブ）と正しい UTF-8 多バイト列の
 * 連続で、長さ（文字数）4 以上のものを抜き出す。
 */
export function extractStrings(buf: Uint8Array, minLen = MIN_LEN): string[] {
  const out: string[] = [];
  let start = -1;
  let chars = 0;
  const flush = (end: number) => {
    if (start >= 0 && chars >= minLen) out.push(Buffer.from(buf.subarray(start, end)).toString("utf8"));
    start = -1;
    chars = 0;
  };
  let i = 0;
  while (i < buf.length) {
    const b = buf[i]!;
    if ((b >= 0x20 && b <= 0x7e) || b === 0x09) {
      if (start < 0) start = i;
      chars++;
      i++;
      continue;
    }
    const n = b >= 0x80 ? utf8SeqLen(buf, i) : 0;
    if (n > 0) {
      if (start < 0) start = i;
      chars++;
      i += n;
      continue;
    }
    flush(i);
    i++;
  }
  flush(buf.length);
  return out;
}

const MAX_BUFFER = 512 * 1024 * 1024;

/** 文字列を抜く。戻り値の via は実際に使った手段 */
export function stringsOf(file: string, tools: Tools): { text: string; via: string } {
  if (tools.strings) {
    const r = spawnSync("strings", ["-a", "-n", String(MIN_LEN), file], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      timeout: 60_000,
    });
    if (!r.error && r.status === 0) return { text: r.stdout, via: "strings" };
  }
  return { text: extractStrings(readFileSync(file)).join("\n"), via: "builtin-strings" };
}

/** nm で記号表を取る。失敗（Linux の nm が Mach-O を読めない等）は null */
export function nmOf(file: string, tools: Tools): string | null {
  if (!tools.nm) return null;
  const r = spawnSync(tools.nm, ["-a", file], {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    timeout: 60_000,
  });
  if (r.error || r.status !== 0 || !r.stdout.trim()) return null;
  return r.stdout;
}

/**
 * nm 既定形式（llvm-nm / GNU / BSD）の行から未定義記号名だけを抜く。
 * 例: "                 U _stat" / "                 U _stat$INODE64"
 * 定義済み（T/t/D/d/S/s など）は含めない。弱未定義 `w` は含める。
 */
export function parseNmUndefined(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:[0-9a-fA-F]+\s+)?([A-Za-z])\s+(\S+)$/);
    if (!m) continue;
    const type = m[1]!;
    if (type === "U" || type === "w") out.push(m[2]!);
  }
  return out;
}

const MACHO_MAGICS = new Set([
  "feedface", // MH_MAGIC (32bit BE)
  "cefaedfe", // MH_CIGAM (32bit LE)
  "feedfacf", // MH_MAGIC_64
  "cffaedfe", // MH_CIGAM_64
  "cafebabe", // FAT_MAGIC (universal)
  "bebafeca", // FAT_CIGAM
  "cafebabf", // FAT_MAGIC_64
  "bfbafeca", // FAT_CIGAM_64
]);

/** 先頭 4 バイトが Mach-O / ユニバーサルのマジックか */
export function hasMachOMagic(file: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const b = Buffer.alloc(4);
    const n = readSync(fd, b, 0, 4, 0);
    if (n < 4) return false;
    return MACHO_MAGICS.has(b.toString("hex"));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
