// Mach-O から __TEXT,__objc_methname のセレクタ名を抜く。
// systemUptime のような ObjC セレクタは nm の未定義記号に出ないため。
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

const MH_MAGIC = 0xfeedface;
const MH_CIGAM = 0xcefaedfe;
const MH_MAGIC_64 = 0xfeedfacf;
const MH_CIGAM_64 = 0xcffaedfe;
const FAT_MAGIC = 0xcafebabe;
const FAT_CIGAM = 0xbebafeca;
const FAT_MAGIC_64 = 0xcafebabf;
const FAT_CIGAM_64 = 0xbfbafeca;

const LC_SEGMENT = 0x01;
const LC_SEGMENT_64 = 0x19;

function u32(buf: Uint8Array, off: number, le: boolean): number {
  if (off + 4 > buf.length) return 0;
  const v = new DataView(buf.buffer, buf.byteOffset + off, 4);
  return le ? v.getUint32(0, true) : v.getUint32(0, false);
}

function u64(buf: Uint8Array, off: number, le: boolean): number {
  if (off + 8 > buf.length) return 0;
  const v = new DataView(buf.buffer, buf.byteOffset + off, 8);
  const x = le ? v.getBigUint64(0, true) : v.getBigUint64(0, false);
  const n = Number(x);
  return Number.isSafeInteger(n) ? n : 0;
}

function cstr16(buf: Uint8Array, off: number): string {
  if (off + 16 > buf.length) return "";
  const slice = buf.subarray(off, off + 16);
  const end = slice.indexOf(0);
  return Buffer.from(slice.subarray(0, end < 0 ? 16 : end)).toString("ascii");
}

function splitCStrings(buf: Uint8Array): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0) {
      if (i > start) out.push(Buffer.from(buf.subarray(start, i)).toString("utf8"));
      start = i + 1;
    }
  }
  return out;
}

function parseThin(buf: Uint8Array, start: number, end: number): string[] {
  if (end > buf.length) end = buf.length;
  if (start < 0 || start + 4 > end) return [];
  const view = buf.subarray(start, end);
  const magic = u32(view, 0, false);
  let le: boolean;
  let is64: boolean;
  if (magic === MH_MAGIC) {
    le = false;
    is64 = false;
  } else if (magic === MH_CIGAM) {
    le = true;
    is64 = false;
  } else if (magic === MH_MAGIC_64) {
    le = false;
    is64 = true;
  } else if (magic === MH_CIGAM_64) {
    le = true;
    is64 = true;
  } else {
    return [];
  }

  const headerSize = is64 ? 32 : 28;
  if (view.length < headerSize) return [];
  const ncmds = u32(view, 16, le);
  const sizeofcmds = u32(view, 20, le);
  if (ncmds < 0 || ncmds > 0x10000) return [];
  if (headerSize + sizeofcmds > view.length) return [];

  const out: string[] = [];
  let off = headerSize;
  const cmdsEnd = headerSize + sizeofcmds;
  for (let i = 0; i < ncmds && off + 8 <= cmdsEnd; i++) {
    const cmd = u32(view, off, le);
    const cmdsize = u32(view, off + 4, le);
    if (cmdsize < 8 || off + cmdsize > cmdsEnd) break;
    if (cmd === LC_SEGMENT || cmd === LC_SEGMENT_64) {
      const seg64 = cmd === LC_SEGMENT_64;
      const sectOff = off + (seg64 ? 72 : 56);
      const nsects = u32(view, off + (seg64 ? 64 : 48), le);
      const sectSize = seg64 ? 80 : 68;
      for (let s = 0; s < nsects; s++) {
        const so = sectOff + s * sectSize;
        if (so + sectSize > off + cmdsize) break;
        const sectname = cstr16(view, so);
        const segname = cstr16(view, so + 16);
        if (segname !== "__TEXT" || sectname !== "__objc_methname") continue;
        const size = seg64 ? u64(view, so + 40, le) : u32(view, so + 36, le);
        const fileoff = seg64 ? u32(view, so + 48, le) : u32(view, so + 40, le);
        if (size <= 0 || fileoff < 0 || fileoff + size > view.length) continue;
        out.push(...splitCStrings(view.subarray(fileoff, fileoff + size)));
      }
    }
    off += cmdsize;
  }
  return out;
}

function parseFat(buf: Uint8Array): string[] {
  if (buf.length < 8) return [];
  const magic = u32(buf, 0, false);
  let le: boolean;
  let is64: boolean;
  if (magic === FAT_MAGIC) {
    le = false;
    is64 = false;
  } else if (magic === FAT_CIGAM) {
    le = true;
    is64 = false;
  } else if (magic === FAT_MAGIC_64) {
    le = false;
    is64 = true;
  } else if (magic === FAT_CIGAM_64) {
    le = true;
    is64 = true;
  } else {
    return [];
  }
  const nfat = u32(buf, 4, le);
  if (nfat <= 0 || nfat > 32) return [];
  const entrySize = is64 ? 32 : 20;
  const out: string[] = [];
  for (let i = 0; i < nfat; i++) {
    const eo = 8 + i * entrySize;
    if (eo + entrySize > buf.length) break;
    const offset = is64 ? u64(buf, eo + 8, le) : u32(buf, eo + 8, le);
    const size = is64 ? u64(buf, eo + 16, le) : u32(buf, eo + 12, le);
    if (offset < 0 || size <= 0 || offset + size > buf.length) continue;
    out.push(...parseThin(buf, offset, offset + size));
  }
  return out;
}

/** バッファが Mach-O / universal なら __objc_methname のセレクタを返す。失敗時は空配列。 */
export function extractObjcMethnames(buf: Uint8Array): string[] {
  if (buf.length < 4) return [];
  try {
    const magic = u32(buf, 0, false);
    if (magic === FAT_MAGIC || magic === FAT_CIGAM || magic === FAT_MAGIC_64 || magic === FAT_CIGAM_64) {
      return parseFat(buf);
    }
    return parseThin(buf, 0, buf.length);
  } catch {
    return [];
  }
}

/** ファイルから __objc_methname を抜く。Mach-O でなければ空配列。 */
export function extractObjcMethnamesFromFile(file: string): string[] {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    if (size <= 0 || size > 0x7fffffff) return [];
    const buf = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      const n = readSync(fd, buf, read, size - read, read);
      if (n <= 0) break;
      read += n;
    }
    return extractObjcMethnames(buf.subarray(0, read));
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
