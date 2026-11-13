import { readdirSync } from "node:fs";
import { join } from "node:path";

export interface WalkResult {
  dirs: string[];
  files: string[];
}

/**
 * ディレクトリを再帰的に歩く。シンボリックリンクはたどらない（macOS framework の
 * Versions/Current や A/B のリンクで二重に数えないため）。
 */
export function walk(root: string, skip: (name: string, full: string) => boolean = () => false): WalkResult {
  const dirs: string[] = [root];
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (skip(e.name, full)) continue;
        dirs.push(full);
        stack.push(full);
      } else if (e.isFile()) {
        files.push(full);
      }
    }
  }
  dirs.sort();
  files.sort();
  return { dirs, files };
}

export function isXcprivacyName(name: string): boolean {
  return name.toLowerCase().endsWith(".xcprivacy");
}
