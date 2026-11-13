// 入力パス → スキャン対象のバンドル根を決める。
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

export class InputError extends Error {}

export interface Root {
  dir: string;
  kind: "app" | "loose";
}

const SKIP_DIRS = new Set(["node_modules", ".git"]);

function appsInArchive(archive: string): string[] {
  const appsDir = join(archive, "Products", "Applications");
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.toLowerCase().endsWith(".app"))
    .map((e) => join(appsDir, e.name))
    .sort();
}

/** ディレクトリ配下の .app / .xcarchive を探す（見つけたらその中には降りない） */
function findContainers(dir: string): string[] {
  const found: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      const full = join(d, e.name);
      const ext = extname(e.name).toLowerCase();
      if (ext === ".app" || ext === ".xcarchive") found.push(full);
      else stack.push(full);
    }
  }
  return found.sort();
}

export function resolveRoots(input: string): Root[] {
  if (!existsSync(input)) throw new InputError(`パスがありません: ${input}`);
  if (!statSync(input).isDirectory()) throw new InputError(`ディレクトリ（.app / .xcarchive / フォルダ）を指定してください: ${input}`);
  const ext = extname(basename(input)).toLowerCase();
  if (ext === ".xcarchive") {
    const apps = appsInArchive(input);
    if (apps.length === 0) throw new InputError(`${input} に Products/Applications/*.app がありません`);
    return apps.map((dir) => ({ dir, kind: "app" }));
  }
  if (ext === ".app") return [{ dir: input, kind: "app" }];

  const containers = findContainers(input);
  if (containers.length === 0) return [{ dir: input, kind: "loose" }];
  const roots: Root[] = [];
  for (const c of containers) {
    if (extname(c).toLowerCase() === ".xcarchive") {
      const apps = appsInArchive(c);
      if (apps.length === 0) throw new InputError(`${c} に Products/Applications/*.app がありません`);
      for (const dir of apps) roots.push({ dir, kind: "app" });
    } else {
      roots.push({ dir: c, kind: "app" });
    }
  }
  return roots;
}
