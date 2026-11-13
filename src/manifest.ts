// PrivacyInfo.xcprivacy の解析と検証。
import { readFileSync } from "node:fs";
import { parse as parseXml, parseBinary, type PlistValue } from "plist";
import { KNOWN_CATEGORIES, REASON_TO_CATEGORY, shortName } from "./required-reason-apis.ts";
import type { DeclaredApi, Issue } from "./types.ts";

export interface ParsedManifest {
  ok: boolean;
  error?: string;
  /** 理由付きで宣言されたカテゴリ（カテゴリ違いの理由コードは除く） */
  declared: DeclaredApi[];
  issues: Omit<Issue, "target">[];
}

/** XML plist / JSON plist / バイナリ plist を読む */
export function readPlist(file: string): PlistValue {
  const buf = readFileSync(file);
  if (buf.subarray(0, 8).toString("latin1") === "bplist00") return parseBinary(new Uint8Array(buf));
  const text = buf.toString("utf8").replace(/^﻿/, "");
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(text) as PlistValue;
  return quietly(() => parseXml(text));
}

/** xmldom が壊れた XML で console に直接書くのを抑える（エラーは例外として扱う） */
function quietly<T>(fn: () => T): T {
  const { error, warn } = console;
  console.error = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

function isDict(v: unknown): v is Record<string, PlistValue> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Uint8Array);
}

export function parseManifestFile(file: string, displayPath: string): ParsedManifest {
  let root: PlistValue;
  try {
    root = readPlist(file);
  } catch (e) {
    const msg = (e as Error).message.split("\n")[0] ?? String(e);
    return {
      ok: false,
      error: msg,
      declared: [],
      issues: [
        {
          type: "invalid_manifest",
          severity: "error",
          message: `${displayPath} を plist として読めません: ${msg}`,
          files: [displayPath],
        },
      ],
    };
  }
  return validateManifest(root, displayPath);
}

export function validateManifest(root: PlistValue, displayPath: string): ParsedManifest {
  const issues: Omit<Issue, "target">[] = [];
  const bad = (message: string): ParsedManifest => ({
    ok: false,
    error: message,
    declared: [],
    issues: [{ type: "invalid_manifest", severity: "error", message, files: [displayPath] }],
  });
  if (!isDict(root)) return bad(`${displayPath}: ルートが dict ではありません`);

  const types = root["NSPrivacyAccessedAPITypes"];
  if (types === undefined) return { ok: true, declared: [], issues };
  if (!Array.isArray(types)) return bad(`${displayPath}: NSPrivacyAccessedAPITypes が配列ではありません`);

  const merged = new Map<string, Set<string>>();
  types.forEach((entry, idx) => {
    const where = `${displayPath} NSPrivacyAccessedAPITypes[${idx}]`;
    if (!isDict(entry)) {
      issues.push({ type: "invalid_manifest", severity: "error", message: `${where} が dict ではありません`, files: [displayPath] });
      return;
    }
    const category = entry["NSPrivacyAccessedAPIType"];
    if (typeof category !== "string" || category === "") {
      issues.push({
        type: "invalid_manifest",
        severity: "error",
        message: `${where}: NSPrivacyAccessedAPIType が無いか文字列ではありません`,
        files: [displayPath],
      });
      return;
    }
    if (!KNOWN_CATEGORIES.has(category)) {
      issues.push({
        type: "unknown_category",
        severity: "error",
        category,
        message: `${where}: 未知のカテゴリ ${category}`,
        files: [displayPath],
      });
      return;
    }
    const reasons = entry["NSPrivacyAccessedAPITypeReasons"];
    if (!Array.isArray(reasons) || reasons.length === 0) {
      issues.push({
        type: "empty_reasons",
        severity: "error",
        category,
        message: `${where}: ${shortName(category)} の NSPrivacyAccessedAPITypeReasons が${Array.isArray(reasons) ? "空" : "ありません"}`,
        files: [displayPath],
      });
      return;
    }
    const accepted = merged.get(category) ?? new Set<string>();
    for (const r of reasons) {
      if (typeof r !== "string" || r.trim() === "") {
        issues.push({
          type: "invalid_manifest",
          severity: "error",
          category,
          message: `${where}: 理由コードに文字列でない / 空の値があります`,
          files: [displayPath],
        });
        continue;
      }
      const owner = REASON_TO_CATEGORY.get(r);
      if (owner === undefined) {
        issues.push({
          type: "unknown_reason",
          severity: "warning",
          category,
          message: `${where}: 未知の理由コード ${r}（${shortName(category)}）。カタログに無いので検証できません`,
          files: [displayPath],
        });
        accepted.add(r);
      } else if (owner !== category) {
        issues.push({
          type: "reason_category_mismatch",
          severity: "error",
          category,
          message: `${where}: 理由コード ${r} は ${shortName(owner)} のもので、${shortName(category)} には使えません`,
          files: [displayPath],
        });
      } else {
        accepted.add(r);
      }
    }
    merged.set(category, accepted);
  });

  const declared: DeclaredApi[] = [];
  for (const [category, reasons] of merged) {
    if (reasons.size > 0) declared.push({ category, reasons: [...reasons].sort() });
  }
  return { ok: true, declared, issues };
}
