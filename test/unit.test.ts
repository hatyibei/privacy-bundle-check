import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildBinary } from "plist";
import { binaryMatchers, sourceMatchers, findSymbols } from "../src/symbols.ts";
import { extractStrings } from "../src/strings.ts";
import { validateManifest, parseManifestFile } from "../src/manifest.ts";
import { CATALOG, REASON_TO_CATEGORY } from "../src/required-reason-apis.ts";
import { scan } from "../src/scan.ts";
import { C, fakeBinary, run, tmp, write, xcprivacy } from "./helpers.ts";

const bin = (text: string) => findSymbols(text, binaryMatchers()).map((m) => m.symbol).sort();
const src = (text: string) => findSymbols(text, sourceMatchers()).map((m) => m.symbol).sort();
const opts = { mode: "bundle" as const, externalTools: false };

// ---- カタログ ----
test("カタログ: 仕様の理由コードとカテゴリ", () => {
  assert.equal(CATALOG.length, 5);
  assert.equal(REASON_TO_CATEGORY.get("CA92.1"), C.ud);
  assert.equal(REASON_TO_CATEGORY.get("35F9.1"), C.boot);
  assert.equal(REASON_TO_CATEGORY.get("E174.1"), C.disk);
  assert.equal(REASON_TO_CATEGORY.get("3EC4.1"), C.kb);
  assert.equal(REASON_TO_CATEGORY.get("0A2A.1"), C.ts);
  // 短すぎる語はバイナリ用に入れない
  for (const c of CATALOG) {
    assert.ok(!c.binary.includes("creationDate"));
    assert.ok(!c.binary.includes("modificationDate"));
    assert.ok(!c.binary.includes("UserDefaults"));
  }
});

// ---- 記号マッチ ----
test("バイナリ記号: C 記号の _ 接頭辞、$INODE64、@plt", () => {
  assert.deepEqual(bin("_stat$INODE64"), ["stat"]);
  assert.deepEqual(bin("__stat"), ["stat"]);
  assert.deepEqual(bin("fstatfs@plt"), ["fstatfs"]);
  assert.deepEqual(bin("_mach_absolute_time"), ["mach_absolute_time"]);
  // kern.boottime is not on Apple's current official type page (checked 2026-11-13)
  assert.deepEqual(bin("sysctlbyname kern.boottime"), []);
});

test("バイナリ記号: 部分一致しない（status, statistics, os_stat, statfsX, stat_foo）", () => {
  assert.deepEqual(bin("status statistics os_stat stat_foo xstat lstatus"), []);
  assert.deepEqual(bin("mystatfs statfsX"), []);
});

test("バイナリ記号: Swift マングル名の長さ接頭辞", () => {
  assert.deepEqual(bin("$sSo13NSProcessInfoC12systemUptimeSdvg"), ["systemUptime"]);
  assert.deepEqual(bin("$s10Foundation12UserDefaultsC8standardACvgZ"), ["UserDefaults"]);
});

test("バイナリ記号: creationDate / modificationDate はバイナリでは拾わない", () => {
  assert.deepEqual(bin("creationDate modificationDate"), []);
  assert.deepEqual(src("let d = attrs[.modificationDate]"), ["modificationDate"]);
});

test("UserDefaults: NSUserDefaults は確定、UserDefaults 単体は参考ヒット", () => {
  const ms = findSymbols("NSUserDefaults", binaryMatchers());
  assert.deepEqual(ms.map((m) => [m.symbol, m.confidence]), [["NSUserDefaults", "confirmed"]]);
  const weak = findSymbols("UserDefaults", binaryMatchers());
  assert.deepEqual(weak.map((m) => [m.symbol, m.confidence]), [["UserDefaults", "weak"]]);
  assert.deepEqual(src("UserDefaults.standard.bool(forKey: x)"), ["UserDefaults"]);
});

test("ソース記号: 単語境界", () => {
  assert.deepEqual(src("let status = 1; stat(path, &st)"), ["stat"]);
  assert.deepEqual(src("ProcessInfo.processInfo.systemUptime"), ["systemUptime"]);
  assert.deepEqual(src("UITextInputMode.activeInputModes"), ["activeInputModes"]);
});

// ---- strings 抽出 ----
test("内蔵 strings: 4 文字以上の ASCII / UTF-8 の連続を抜く", () => {
  const buf = Buffer.concat([
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 1]),
    Buffer.from("abc\0abcd\0_mach_absolute_time\x01"),
    Buffer.from("設定画面\0", "utf8"),
    Buffer.from([0xff, 0xfe]),
    Buffer.from("tail"),
  ]);
  assert.deepEqual(extractStrings(buf), ["abcd", "_mach_absolute_time", "設定画面", "tail"]);
});

// ---- マニフェスト ----
test("マニフェスト: 正常", () => {
  const p = validateManifest(
    { NSPrivacyAccessedAPITypes: [{ NSPrivacyAccessedAPIType: C.ud, NSPrivacyAccessedAPITypeReasons: ["CA92.1"] }] },
    "x",
  );
  assert.equal(p.ok, true);
  assert.deepEqual(p.issues, []);
  assert.deepEqual(p.declared, [{ category: C.ud, reasons: ["CA92.1"] }]);
});

test("マニフェスト: 空の理由、未知カテゴリ、未知コード（warning）、カテゴリ違いのコード", () => {
  const p = validateManifest(
    {
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: C.ud, NSPrivacyAccessedAPITypeReasons: [] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryMadeUp", NSPrivacyAccessedAPITypeReasons: ["X.1"] },
        { NSPrivacyAccessedAPIType: C.disk, NSPrivacyAccessedAPITypeReasons: ["ZZZZ.9"] },
        { NSPrivacyAccessedAPIType: C.boot, NSPrivacyAccessedAPITypeReasons: ["CA92.1"] },
        { NSPrivacyAccessedAPIType: C.kb },
      ],
    },
    "x",
  );
  const t = p.issues.map((i) => [i.type, i.severity]);
  assert.deepEqual(t, [
    ["empty_reasons", "error"],
    ["unknown_category", "error"],
    ["unknown_reason", "warning"],
    ["reason_category_mismatch", "error"],
    ["empty_reasons", "error"],
  ]);
  // 未知コードは宣言として扱う（検証できないだけ）。カテゴリ違いのコードだけなら宣言扱いしない
  assert.deepEqual(p.declared.map((d) => d.category), [C.disk]);
});

test("マニフェスト: 壊れた XML / ルートが dict でない / 型違い", () => {
  const d = tmp();
  write(join(d, "a.xcprivacy"), "<plist><dict><key>x</key>");
  assert.equal(parseManifestFile(join(d, "a.xcprivacy"), "a").issues[0]!.type, "invalid_manifest");
  assert.equal(validateManifest(["x"], "x").issues[0]!.type, "invalid_manifest");
  assert.equal(validateManifest({ NSPrivacyAccessedAPITypes: "x" }, "x").issues[0]!.type, "invalid_manifest");
  // NSPrivacyAccessedAPITypes が無いのは OK（何も使っていない）
  assert.deepEqual(validateManifest({ NSPrivacyTracking: false }, "x").issues, []);
});

test("マニフェスト: JSON plist とバイナリ plist も読める", () => {
  const d = tmp();
  const obj = { NSPrivacyAccessedAPITypes: [{ NSPrivacyAccessedAPIType: C.ts, NSPrivacyAccessedAPITypeReasons: ["C617.1"] }] };
  write(join(d, "j.xcprivacy"), JSON.stringify(obj));
  write(join(d, "b.xcprivacy"), buildBinary(obj));
  for (const f of ["j.xcprivacy", "b.xcprivacy"]) {
    const p = parseManifestFile(join(d, f), f);
    assert.equal(p.ok, true, f);
    assert.deepEqual(p.declared, [{ category: C.ts, reasons: ["C617.1"] }]);
  }
});

// ---- バンドル ----
function app(d: string, opts2: { manifest?: string | null; symbols?: string[] } = {}) {
  const a = join(d, "My.app");
  write(join(a, "My"), fakeBinary(opts2.symbols ?? ["NSUserDefaults"]));
  if (opts2.manifest !== null) write(join(a, "PrivacyInfo.xcprivacy"), opts2.manifest ?? xcprivacy([{ category: C.ud, reasons: ["CA92.1"] }]));
  return a;
}

test("重複: 大文字小文字違い（Linux では別ファイル）も duplicate_manifest", () => {
  const d = tmp();
  const a = app(d);
  write(join(a, "PrivacyInfo.XCPrivacy"), xcprivacy([{ category: C.ud, reasons: ["CA92.1"] }]));
  const r = scan(d, opts);
  assert.deepEqual(r.issues.map((i) => i.type), ["duplicate_manifest"]);
});

test("重複: サブバンドル（framework）のマニフェストは親の重複に数えない", () => {
  const d = tmp();
  const a = app(d);
  write(join(a, "Frameworks/A.framework/PrivacyInfo.xcprivacy"), xcprivacy([]));
  write(join(a, "Frameworks/A.framework/A"), fakeBinary([]));
  write(join(a, "PlugIns/W.appex/PrivacyInfo.xcprivacy"), xcprivacy([]));
  write(join(a, "PlugIns/W.appex/W"), fakeBinary([]));
  const r = scan(d, opts);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.bundles.map((b) => b.kind), ["app", "framework", "appex"]);
  assert.equal(r.manifests.length, 3);
});

test("埋め込み framework: 記号なし・マニフェストなしは warning、記号ありは error", () => {
  const d = tmp();
  const a = app(d);
  write(join(a, "Frameworks/Quiet.framework/Quiet"), fakeBinary(["_main"]));
  write(join(a, "PlugIns/Loud.appex/Loud"), fakeBinary(["_statvfs"]));
  const r = scan(d, opts);
  const quiet = r.issues.find((i) => i.target.endsWith("Quiet.framework"))!;
  const loud = r.issues.find((i) => i.target.endsWith("Loud.appex"))!;
  assert.equal(quiet.type, "missing_manifest");
  assert.equal(quiet.severity, "warning");
  assert.equal(loud.type, "missing_manifest");
  assert.equal(loud.severity, "error");
  assert.equal(r.summary.errors, 1);
});

test("アプリ本体: 記号が無くてもマニフェスト欠如は error", () => {
  const d = tmp();
  app(d, { manifest: null, symbols: ["_main"] });
  const r = scan(d, opts);
  assert.deepEqual(r.issues.map((i) => [i.type, i.severity]), [["missing_manifest", "error"]]);
});

test("UserDefaults 単体のみ（参考ヒット）で未宣言なら warning、--strict で終了 1", () => {
  const d = tmp();
  app(d, { manifest: xcprivacy([]), symbols: ["$s10Foundation12UserDefaultsC8standardACvgZ"] });
  const r = scan(d, opts);
  assert.deepEqual(r.issues.map((i) => [i.type, i.severity]), [["possible_undeclared_api", "warning"]]);
  assert.equal(run(["scan", d]).code, 0);
  assert.equal(run(["scan", d, "--strict"]).code, 1);
});

test("Mach-O マジックのファイルと .dylib もスキャン対象、関係ないファイルは対象外", () => {
  const d = tmp();
  const a = app(d);
  write(join(a, "helper"), fakeBinary(["_mach_absolute_time"], Buffer.from([0xcf, 0xfa, 0xed, 0xfe])));
  write(join(a, "Frameworks/libx.dylib"), fakeBinary(["_statfs"]));
  write(join(a, "notes.txt"), "_getattrlist");
  const r = scan(d, opts);
  const mainB = r.bundles.find((b) => b.main)!;
  assert.deepEqual(mainB.binaries.sort(), ["My.app/Frameworks/libx.dylib", "My.app/My", "My.app/helper"]);
  assert.deepEqual(
    r.issues.filter((i) => i.type === "undeclared_api").map((i) => i.category).sort(),
    [C.boot, C.disk].sort(),
  );
});

test("resource bundle (.bundle) のマニフェストは持ち主のバンドルの宣言に加える", () => {
  const d = tmp();
  const a = app(d, { symbols: ["NSUserDefaults", "_mach_absolute_time"] });
  write(join(a, "Analytics_Analytics.bundle/PrivacyInfo.xcprivacy"), xcprivacy([{ category: C.boot, reasons: ["35F9.1"] }]));
  const r = scan(d, opts);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.bundles[0]!.declaredCategories, [C.boot, C.ud]);
});

test("バンドル根以外に置かれた xcprivacy は misplaced_manifest（warning）で宣言に数えない", () => {
  const d = tmp();
  const a = app(d, { symbols: ["NSUserDefaults", "_mach_absolute_time"] });
  write(join(a, "Assets/PrivacyInfo.xcprivacy"), xcprivacy([{ category: C.boot, reasons: ["35F9.1"] }]));
  const r = scan(d, opts);
  assert.deepEqual(r.issues.map((i) => i.type).sort(), ["misplaced_manifest", "undeclared_api"]);
});

test("マニフェストの問題（空の理由）は終了 1、宣言扱いにならず undeclared_api も出る", () => {
  const d = tmp();
  app(d, { manifest: xcprivacy([{ category: C.ud, reasons: [] }]) });
  const r = scan(d, opts);
  assert.deepEqual(r.issues.map((i) => i.type).sort(), ["empty_reasons", "undeclared_api"]);
});

test("ゆるいバンドル根: .app が無いフォルダはそのフォルダを本体として扱う", () => {
  const d = tmp();
  write(join(d, "PrivacyInfo.xcprivacy"), xcprivacy([{ category: C.disk, reasons: ["E174.1"] }]));
  write(join(d, "libcore.dylib"), fakeBinary(["NSURLVolumeAvailableCapacityForImportantUsageKey"]));
  const r = scan(d, opts);
  assert.equal(r.bundles[0]!.kind, "loose");
  assert.deepEqual(r.issues, []);
});

test("フォルダの中の複数 .app / .xcarchive を全部見る", () => {
  const d = tmp();
  app(join(d, "a"));
  app(join(d, "b"), { manifest: null });
  write(join(d, "c/X.xcarchive/Products/Applications/Y.app/Y"), fakeBinary(["_main"]));
  write(join(d, "c/X.xcarchive/Products/Applications/Y.app/PrivacyInfo.xcprivacy"), xcprivacy([]));
  const r = scan(d, opts);
  assert.equal(r.bundles.filter((b) => b.main).length, 3);
  assert.deepEqual(r.issues.map((i) => [i.target, i.type]), [["b/My.app", "missing_manifest"]]);
});

test("xcarchive に .app が無ければ入力エラー（終了 2）", () => {
  const d = tmp();
  write(join(d, "Empty.xcarchive/Info.plist"), "<plist/>");
  assert.equal(run(["scan", join(d, "Empty.xcarchive")]).code, 2);
});

test("外部ツールあり / なしで同じ判定", () => {
  const d = tmp();
  app(d, { symbols: ["NSUserDefaults", "_fstatat", "activeInputModes"] });
  const a = scan(d, { mode: "bundle", externalTools: true });
  const b = scan(d, opts);
  assert.deepEqual(a.issues.map((i) => i.category), b.issues.map((i) => i.category));
  assert.equal(b.issues.length, 2);
});

// ---- プロジェクトモード ----
test("プロジェクト: 同じディレクトリの複数 xcprivacy は duplicate_manifest", () => {
  const d = tmp();
  write(join(d, "App/PrivacyInfo.xcprivacy"), xcprivacy([]));
  write(join(d, "App/PrivacyInfo.XCPRIVACY"), xcprivacy([]));
  const r = scan(d, { mode: "project", externalTools: false });
  assert.deepEqual(r.issues.map((i) => i.type), ["duplicate_manifest"]);
});

test("プロジェクト: 宣言済みなら問題なし、ソースはコメントも拾う（制限）", () => {
  const d = tmp();
  write(join(d, "App/PrivacyInfo.xcprivacy"), xcprivacy([{ category: C.ud, reasons: ["CA92.1"] }]));
  write(join(d, "App/A.swift"), "// mach_absolute_time はもう使っていない\nlet v = UserDefaults.standard.bool(forKey: \"k\")\n");
  const r = scan(d, { mode: "project", externalTools: false });
  assert.deepEqual(r.issues.map((i) => [i.type, i.category]), [["undeclared_api", C.boot]]);
});


// ---- Official catalog (Apple docs, 2026-11-13) ----
test("公式カタログ: 5 カテゴリと 17 の理由コード、現行公式に無い記号は確定扱いにしない", () => {
  const reasons = CATALOG.flatMap((c) => c.reasons).sort();
  assert.deepEqual(reasons, [
    "0A2A.1", "1C8F.1", "35F9.1", "3B52.1", "3D61.1", "3EC4.1", "54BD.1",
    "7D9E.1", "85F4.1", "8FFB.1", "AC6B.1", "B728.1", "C56D.1", "C617.1",
    "CA92.1", "DDA9.1", "E174.1",
  ].sort());
  const boot = CATALOG.find((c) => c.short === "SystemBootTime")!;
  assert.deepEqual([...boot.binary].sort(), ["mach_absolute_time", "systemUptime"]);
  const ud = CATALOG.find((c) => c.short === "UserDefaults")!;
  assert.ok(ud.binary.includes("NSUserDefaults"));
  assert.ok(!ud.binary.includes("CFPreferencesCopyAppValue"));
  assert.ok(!ud.binary.includes("CFPreferencesSetAppValue"));
  assert.deepEqual(bin("CFPreferencesCopyAppValue CFPreferencesSetAppValue"), []);
});

test("fileModificationDate は FileTimestamp の確定記号（UIDocument、公式掲載）", () => {
  const ms = findSymbols("fileModificationDate", binaryMatchers());
  assert.equal(ms.length, 1);
  assert.equal(ms[0]!.symbol, "fileModificationDate");
  assert.equal(ms[0]!.category, C.ts);
  assert.equal(ms[0]!.confidence, "confirmed");
});

test("getattrlist は FileTimestamp と DiskSpace の両方。片方の宣言で足りる", () => {
  const ms = findSymbols("_getattrlist", binaryMatchers());
  assert.deepEqual(ms.map((m) => m.category).sort(), [C.disk, C.ts].sort());

  const onlyDisk = tmp();
  app(onlyDisk, {
    manifest: xcprivacy([{ category: C.disk, reasons: ["E174.1"] }]),
    symbols: ["_getattrlist"],
  });
  assert.deepEqual(scan(onlyDisk, opts).issues, []);

  const onlyTs = tmp();
  app(onlyTs, {
    manifest: xcprivacy([{ category: C.ts, reasons: ["C617.1"] }]),
    symbols: ["_getattrlist"],
  });
  assert.deepEqual(scan(onlyTs, opts).issues, []);

  const neither = tmp();
  app(neither, {
    manifest: xcprivacy([]),
    symbols: ["_getattrlist"],
  });
  const r = scan(neither, opts);
  assert.deepEqual(r.issues.map((i) => i.type), ["undeclared_api"]);
  // 両カテゴリに載る記号は、先に出る FileTimestamp 側に一度だけ出す
  assert.equal(r.issues[0]!.category, C.ts);
  assert.deepEqual(r.issues[0]!.symbols, ["getattrlist"]);
});

test("getattrlistbulk は FileTimestamp のみ（DiskSpace の宣言では足りない）", () => {
  const d = tmp();
  app(d, {
    manifest: xcprivacy([{ category: C.disk, reasons: ["E174.1"] }]),
    symbols: ["_getattrlistbulk"],
  });
  const r = scan(d, opts);
  assert.deepEqual(r.issues.map((i) => [i.type, i.category]), [["undeclared_api", C.ts]]);
});
