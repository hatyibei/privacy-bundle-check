import type { Category } from "./required-reason-apis.ts";

export type Severity = "error" | "warning";

export type IssueType =
  | "missing_manifest"
  | "undeclared_api"
  | "possible_undeclared_api"
  | "duplicate_manifest"
  | "invalid_manifest"
  | "empty_reasons"
  | "unknown_category"
  | "unknown_reason"
  | "reason_category_mismatch"
  | "misplaced_manifest";

export interface Issue {
  type: IssueType;
  severity: Severity;
  /** 対象（バンドル / ユニット）のパス。入力ルートからの相対 */
  target: string;
  message: string;
  category?: string;
  files?: string[];
  symbols?: string[];
}

export type Confidence = "confirmed" | "weak";

export interface SymbolHit {
  symbol: string;
  /** Primary category (first official category in catalog order) */
  category: Category;
  /** All official categories that list this symbol (FileTimestamp+DiskSpace for getattrlist, etc.) */
  categories: Category[];
  confidence: Confidence;
  /** どこで見つけたか: strings / nm / source */
  via: string[];
  /** ファイル（入力ルートからの相対）。ソースの場合は file:line */
  locations: string[];
}

export interface DeclaredApi {
  category: string;
  reasons: string[];
}

export interface ManifestInfo {
  path: string;
  /** root = バンドル根（または Resources）直下、resource-bundle = 中の .bundle、misplaced = それ以外 */
  role: "root" | "resource-bundle" | "misplaced";
  ok: boolean;
  declared: DeclaredApi[];
  error?: string;
}

export interface BundleReport {
  path: string;
  kind: "app" | "framework" | "appex" | "xctest" | "loose" | "project-unit";
  /** アプリ本体（または ゆるいバンドル根 / プロジェクトのルート）か */
  main: boolean;
  manifests: ManifestInfo[];
  binaries: string[];
  hits: SymbolHit[];
  /** 理由付きで宣言されているカテゴリ */
  declaredCategories: string[];
}

export interface ScanResult {
  input: string;
  mode: "bundle" | "project";
  tools: { strings: boolean; nm: string | null };
  bundles: BundleReport[];
  manifests: string[];
  issues: Issue[];
  summary: { errors: number; warnings: number };
}
