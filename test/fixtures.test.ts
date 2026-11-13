// 必須フィクスチャを実際に CLI で scan し、終了コードと問題タイプを断言する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FIX, run, types } from "./helpers.ts";

for (const tools of [[], ["--no-external-tools"]]) {
  const label = tools.length ? "（内蔵 strings のみ）" : "（strings/nm コマンドがあれば使用）";

  test(`app-ok は終了 0 ${label}`, () => {
    const r = run(["scan", join(FIX, "app-ok"), "--json", ...tools]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(r.json!.issues, []);
    const app = r.json!.bundles.find((b) => b.path === "Sample.app")!;
    assert.equal(app.main, true);
    assert.deepEqual(app.hits.map((h) => h.symbol), ["NSUserDefaults"]);
    const fw = r.json!.bundles.find((b) => b.kind === "framework")!;
    assert.equal(fw.path, "Sample.app/Frameworks/Util.framework");
    assert.deepEqual(fw.hits.map((h) => h.symbol).sort(), ["NSFileModificationDate", "stat"]);
    assert.deepEqual(r.json!.manifests, [
      "Sample.app/Frameworks/Util.framework/PrivacyInfo.xcprivacy",
      "Sample.app/PrivacyInfo.xcprivacy",
    ]);
  });

  test(`app-missing-manifest は終了 1 / missing_manifest ${label}`, () => {
    const r = run(["scan", join(FIX, "app-missing-manifest"), "--json", ...tools]);
    assert.equal(r.code, 1);
    assert.deepEqual(types(r), ["missing_manifest"]);
    const i = r.json!.issues[0]!;
    assert.equal(i.severity, "error");
    assert.equal(i.target, "Sample.app");
  });

  test(`app-undeclared-api は終了 1 / undeclared_api (SystemBootTime) ${label}`, () => {
    const r = run(["scan", join(FIX, "app-undeclared-api"), "--json", ...tools]);
    assert.equal(r.code, 1);
    assert.deepEqual(types(r), ["undeclared_api"]);
    const i = r.json!.issues[0]!;
    assert.equal(i.category, "NSPrivacyAccessedAPICategorySystemBootTime");
    assert.deepEqual(i.symbols, ["mach_absolute_time"]);
  });

  test(`app-duplicate-privacy は終了 1 / duplicate_manifest ${label}`, () => {
    const r = run(["scan", join(FIX, "app-duplicate-privacy"), "--json", ...tools]);
    assert.equal(r.code, 1);
    assert.deepEqual(types(r), ["duplicate_manifest"]);
    const i = r.json!.issues[0]!;
    assert.equal(i.target, "Sample.app");
    assert.deepEqual(i.files, ["Sample.app/PrivacyInfo 2.xcprivacy", "Sample.app/PrivacyInfo.xcprivacy"]);
  });

  test(`xcarchive-ok は終了 0 ${label}`, () => {
    const r = run(["scan", join(FIX, "xcarchive-ok"), "--json", ...tools]);
    assert.equal(r.code, 0, r.stdout);
    assert.deepEqual(r.json!.issues, []);
    assert.equal(r.json!.bundles.length, 2);
    assert.equal(r.json!.bundles[0]!.path, "Sample.xcarchive/Products/Applications/Sample.app");
  });
}

test("xcarchive を直接指定しても Products/Applications/*.app を本体として扱う", () => {
  const r = run(["scan", join(FIX, "xcarchive-ok", "Sample.xcarchive"), "--json"]);
  assert.equal(r.code, 0);
  assert.equal(r.json!.bundles.find((b) => b.main)!.path, "Sample.xcarchive/Products/Applications/Sample.app");
});

test(".app を直接指定できる", () => {
  const r = run(["scan", join(FIX, "app-undeclared-api", "Sample.app"), "--json"]);
  assert.equal(r.code, 1);
  assert.deepEqual(types(r), ["undeclared_api"]);
  assert.equal(r.json!.issues[0]!.target, "Sample.app");
});

test("project-source (--mode project): UserDefaults.standard があるのにマニフェストが無いユニットを報告", () => {
  const r = run(["scan", join(FIX, "project-source"), "--mode", "project", "--json"]);
  assert.equal(r.code, 1);
  assert.deepEqual(types(r), ["missing_manifest"]);
  const i = r.json!.issues[0]!;
  assert.equal(i.target, "Packages/SettingsKit/Sources/SettingsKit");
  assert.ok(i.symbols!.includes("UserDefaults"));
  // App 側は modificationDate（ソース専用語）が FileTimestamp で宣言済みなので問題なし
  const root = r.json!.bundles.find((b) => b.main)!;
  assert.deepEqual(root.declaredCategories, ["NSPrivacyAccessedAPICategoryFileTimestamp"]);
  assert.deepEqual(root.hits.map((h) => h.symbol), ["modificationDate"]);
});

test("extra/project-pbxproj-duplicate (--mode project): Copy Bundle Resources の重複", () => {
  const r = run(["scan", join(FIX, "extra", "project-pbxproj-duplicate"), "--mode", "project", "--json"]);
  assert.equal(r.code, 1);
  assert.deepEqual(types(r), ["duplicate_manifest"]);
  assert.equal(r.json!.issues[0]!.target, "Demo.xcodeproj#Demo");
});

test("テキスト出力にも問題タイプが出る", () => {
  const r = run(["scan", join(FIX, "app-missing-manifest")]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /ERROR missing_manifest/);
  assert.match(r.stdout, /error 1 件/);
});

test("入力エラーは終了 2", () => {
  assert.equal(run(["scan", join(FIX, "does-not-exist")]).code, 2);
  assert.equal(run(["scan", join(FIX, "app-ok", "Sample.app", "Info.plist")]).code, 2);
  assert.equal(run(["scan"]).code, 2);
  assert.equal(run(["nope", "x"]).code, 2);
  assert.equal(run(["scan", join(FIX, "app-ok"), "--mode", "weird"]).code, 2);
  assert.equal(run(["scan", join(FIX, "app-ok"), "--unknown-flag"]).code, 2);
  assert.equal(run(["--help"]).code, 0);
});
