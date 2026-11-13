// Required Reason API catalog, checked against Apple's documentation on 2026-11-13:
// - https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
// - https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
// - https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype
// - https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons
// - https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest
// - https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk
//
// The official type page lists Swift names (creationDate, volumeAvailableCapacityKey, UserDefaults, …).
// Binary scans also look for the Objective-C constant names Apple shows as the ObjC title of the same
// symbols (NSFileCreationDate, NSURLVolumeAvailableCapacityKey, NSUserDefaults, …).
//
// Symbols are in 3 groups:
//   binary     … used in artifact scans; a hit is "confirmed"
//   binaryWeak … artifact "possible" hit; undeclared → warning, not error
//   sourceOnly … project-mode source scans only (short / generic words)
//
// getattrlist / fgetattrlist / getattrlistat appear in both FileTimestamp and DiskSpace
// on the official page. A hit is satisfied if either category is declared.

export type Category =
  | "NSPrivacyAccessedAPICategoryFileTimestamp"
  | "NSPrivacyAccessedAPICategorySystemBootTime"
  | "NSPrivacyAccessedAPICategoryDiskSpace"
  | "NSPrivacyAccessedAPICategoryActiveKeyboards"
  | "NSPrivacyAccessedAPICategoryUserDefaults";

export interface CategoryDef {
  category: Category;
  /** Short name for display */
  short: string;
  binary: string[];
  binaryWeak: string[];
  sourceOnly: string[];
  /** Approved reason codes for this category (official list as of 2026-11-13) */
  reasons: string[];
}

export const CATALOG: readonly CategoryDef[] = [
  {
    category: "NSPrivacyAccessedAPICategoryFileTimestamp",
    short: "FileTimestamp",
    binary: [
      "NSFileCreationDate",
      "NSFileModificationDate",
      "fileModificationDate",
      "NSURLCreationDateKey",
      "NSURLContentModificationDateKey",
      "creationDateKey",
      "contentModificationDateKey",
      "getattrlist",
      "getattrlistat",
      "getattrlistbulk",
      "fgetattrlist",
      "stat",
      "fstat",
      "fstatat",
      "lstat",
    ],
    binaryWeak: [],
    // Official Swift names; too short/generic for a binary strings scan
    sourceOnly: ["creationDate", "modificationDate"],
    reasons: ["DDA9.1", "C617.1", "3B52.1", "0A2A.1"],
  },
  {
    category: "NSPrivacyAccessedAPICategorySystemBootTime",
    short: "SystemBootTime",
    // Official list is systemUptime and mach_absolute_time only.
    // kern.boottime is not on the current official type page (as of 2026-11-13).
    binary: ["systemUptime", "mach_absolute_time"],
    binaryWeak: [],
    sourceOnly: [],
    reasons: ["35F9.1", "8FFB.1", "3D61.1"],
  },
  {
    category: "NSPrivacyAccessedAPICategoryDiskSpace",
    short: "DiskSpace",
    binary: [
      "NSFileSystemFreeSize",
      "NSFileSystemSize",
      "systemFreeSize",
      "systemSize",
      "NSURLVolumeAvailableCapacityKey",
      "NSURLVolumeAvailableCapacityForImportantUsageKey",
      "NSURLVolumeAvailableCapacityForOpportunisticUsageKey",
      "NSURLVolumeTotalCapacityKey",
      "volumeAvailableCapacityKey",
      "volumeAvailableCapacityForImportantUsageKey",
      "volumeAvailableCapacityForOpportunisticUsageKey",
      "volumeTotalCapacityKey",
      "statfs",
      "statvfs",
      "fstatfs",
      "fstatvfs",
      // Also listed under FileTimestamp on the official page
      "getattrlist",
      "fgetattrlist",
      "getattrlistat",
    ],
    binaryWeak: [],
    sourceOnly: [],
    reasons: ["E174.1", "85F4.1", "7D9E.1", "B728.1"],
  },
  {
    category: "NSPrivacyAccessedAPICategoryActiveKeyboards",
    short: "ActiveKeyboards",
    binary: ["activeInputModes"],
    binaryWeak: [],
    sourceOnly: [],
    reasons: ["3EC4.1", "54BD.1"],
  },
  {
    category: "NSPrivacyAccessedAPICategoryUserDefaults",
    short: "UserDefaults",
    // Official page names UserDefaults; NSUserDefaults is the ObjC title of the same type.
    // CFPreferences* is not on the current official type page (as of 2026-11-13).
    binary: ["NSUserDefaults"],
    // Bare `UserDefaults` is easy to false-positive in a binary (Swift mangling, unrelated strings)
    binaryWeak: ["UserDefaults"],
    sourceOnly: ["UserDefaults"],
    reasons: ["CA92.1", "1C8F.1", "C56D.1", "AC6B.1"],
  },
];

export const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(CATALOG.map((c) => c.category));

/** Reason code → the category it belongs to */
export const REASON_TO_CATEGORY: ReadonlyMap<string, Category> = new Map(
  CATALOG.flatMap((c) => c.reasons.map((r) => [r, c.category] as const)),
);

const SYMBOL_CATEGORIES: ReadonlyMap<string, Category[]> = (() => {
  const m = new Map<string, Category[]>();
  for (const c of CATALOG) {
    for (const sym of [...c.binary, ...c.binaryWeak, ...c.sourceOnly]) {
      const list = m.get(sym) ?? [];
      if (!list.includes(c.category)) list.push(c.category);
      m.set(sym, list);
    }
  }
  return m;
})();

export function categoryDef(category: string): CategoryDef | undefined {
  return CATALOG.find((c) => c.category === category);
}

export function shortName(category: string): string {
  return categoryDef(category)?.short ?? category;
}

/** Every official category that lists this symbol */
export function categoriesForSymbol(symbol: string): Category[] {
  return SYMBOL_CATEGORIES.get(symbol) ?? [];
}

/** True if any official category for this symbol is declared with a reason */
export function isSymbolSatisfied(symbol: string, declared: ReadonlySet<string>): boolean {
  return categoriesForSymbol(symbol).some((c) => declared.has(c));
}

/** First undeclared official category for a symbol, in catalog order */
export function firstUndeclaredCategory(symbol: string, declared: ReadonlySet<string>): Category | undefined {
  return categoriesForSymbol(symbol).find((c) => !declared.has(c));
}
