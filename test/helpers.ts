import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScanResult } from "../src/types.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIX = join(ROOT, "fixtures");
const CLI = join(ROOT, "src", "cli.ts");

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  json?: ScanResult;
}

export function run(args: string[]): RunResult {
  const r = spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], { encoding: "utf8", cwd: ROOT });
  const out: RunResult = { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
  if (args.includes("--json") && r.stdout.trim().startsWith("{")) out.json = JSON.parse(r.stdout) as ScanResult;
  return out;
}

export function types(r: RunResult): string[] {
  return [...new Set(r.json!.issues.map((i) => i.type))].sort();
}

export function tmp(): string {
  return mkdtempSync(join(tmpdir(), "pmc-test-"));
}

export function write(file: string, content: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

export function xcprivacy(entries: { category: string; reasons: string[] }[]): string {
  const body = entries
    .map(
      (e) => `    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>${e.category}</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>${e.reasons.map((r) => `<string>${r}</string>`).join("")}</array>
    </dict>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
${body}
  </array>
</dict>
</plist>
`;
}

export const C = {
  ts: "NSPrivacyAccessedAPICategoryFileTimestamp",
  boot: "NSPrivacyAccessedAPICategorySystemBootTime",
  disk: "NSPrivacyAccessedAPICategoryDiskSpace",
  kb: "NSPrivacyAccessedAPICategoryActiveKeyboards",
  ud: "NSPrivacyAccessedAPICategoryUserDefaults",
};

/** 疑似バイナリ: NUL 区切りで記号名を埋め込む */
export function fakeBinary(symbols: string[], prefix: Uint8Array = Buffer.from("FAKE\0")): Buffer {
  return Buffer.concat([Buffer.from(prefix), Buffer.from(symbols.join("\0") + "\0")]);
}
