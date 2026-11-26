# privacy-bundle-check

> [!NOTE]
> ライセンスは Apache-2.0。GitHub（Action と CLI）で配布しており、npm には公開していません。

[English README](README.md)

ビルド済みの iOS / macOS `.app` や `.xcarchive` を CI で見て、Privacy Manifest の問題を落とします。`PrivacyInfo.xcprivacy` の不足・重複、そして Required Reason API の記号が、最も近いバンドルのマニフェストに承認された理由なしで残っていないか、です。

## この名前について

リポジトリ名は `privacy-manifest-check` ではなく `privacy-bundle-check` です。同じ名前の公開リポジトリが既にあり、とくに [INNERLUXES/privacy-manifest-check](https://github.com/INNERLUXES/privacy-manifest-check) は **ソース** を走査します。こちらは **ビルド済みバンドル** を見るので、その差分で名付けています。

## なぜあるか

[stelabouras/privacy-manifest](https://github.com/stelabouras/privacy-manifest) のようなソース行スキャンは、プロジェクトの文言は分かります。バイナリ SDK や、コピー衝突のあとにアーカイブへ実際に入った `PrivacyInfo.xcprivacy` は見えません。

ビルド後の CI で欲しいのは次です。

- アプリ本体と埋め込み framework / appex に、まだマニフェストがあるか
- 同じバンドルディレクトリに xcprivacy が二つ入っていないか
- バイナリに残っている Required Reason API の記号が、そのバイナリを持つバンドルのマニフェストで、そのカテゴリ向けの理由付きで宣言されているか

`privacy-bundle-check` はその三つを見ます。App Store Connect や Apple 自身の検証器と一致する、とは言いません。

## すぐに使う

### GitHub Action

```yaml
- uses: hatyibei/privacy-bundle-check@v1
  with:
    path: build/MyApp.xcarchive
    mode: bundle
    strict: "false"
```

入力:

| 入力 | 既定 | 意味 |
|---|---|---|
| `path` | （必須） | ワークスペースからの相対で、`.app` / `.xcarchive` / ディレクトリ。 |
| `mode` | `bundle` | `bundle` は成果物。`project` はソースと xcprivacy を歩く（比較用）。 |
| `strict` | `false` | `true` なら warning でも失敗。 |

出力:

| 出力 | 意味 |
|---|---|
| `exit-code` | `0` / `1` / `2`（[終了コード](#終了コード)）。 |

Action は事前ビルドした束ね済みファイル（`dist/index.cjs`）を Node 24 で実行します。利用側で依存関係のインストールや TypeScript のコンパイルは不要です。

### CLI

Node.js 20 以降。npm には無いので、GitHub から直接実行します（再現性のためタグを固定）:

```sh
npx github:hatyibei/privacy-bundle-check#v1 scan path/to/MyApp.xcarchive
npx github:hatyibei/privacy-bundle-check#v1 scan path/to/MyApp.app --json
npx github:hatyibei/privacy-bundle-check#v1 scan path/to/repo --mode project
```

開発依存に追加する場合:

```sh
npm i -D github:hatyibei/privacy-bundle-check#v1
```

```
privacy-bundle-check scan <path> [--mode bundle|project] [--json] [--strict] [--no-external-tools]
```

| フラグ | 意味 |
| --- | --- |
| `--mode bundle` | 既定。成果物を見る。 |
| `--mode project` | ソース（`.swift` / `.m` / `.mm` / `.c` / `.h` など）と xcprivacy を歩く。 |
| `--json` | 結果を JSON で出す。 |
| `--strict` | warning でも終了コード 1。 |
| `--no-external-tools` | `strings` / `nm` を使わず、内蔵の文字列抽出だけにする。 |

### 終了コード

| コード | 意味 |
| --- | --- |
| 0 | 問題なし（warning だけのときも 0。`--strict` なら 1）。 |
| 1 | 不足・未宣言・重複・マニフェストの不備など error。 |
| 2 | 入力エラー（パスが無い、ファイルを指定した、`.xcarchive` に `.app` が無い、引数の誤り）。 |

## 何を見るか

### バンドル

- `*.xcarchive` → `Products/Applications/*.app` をそれぞれ本体にする（無ければ入力エラー）。
- `*.app` → それ自体。
- ディレクトリ → 中の `*.app` / `*.xcarchive`。無ければそのディレクトリをゆるいバンドル根として扱う（フィクスチャや展開済み出力用）。
- 本体の中の `.app` / `.framework` / `.appex` / `.xctest` を別バンドルとして列挙する。シンボリックリンクはたどらない。

マニフェストの置き場所（Apple の「Adding a privacy manifest to your app or third-party SDK」と「Placing content in a bundle」）:

- iOS / iPadOS / tvOS / visionOS / watchOS: バンドル根。
- macOS / Mac Catalyst の app: `Contents/Resources/`。
- macOS / Mac Catalyst の framework: `Versions/*/Resources/`。

resource bundle（`*.bundle`。SwiftPM の `Foo_Foo.bundle` など）の直下にある xcprivacy は、持ち主のバンドルの宣言に加えます。ただし本体のマニフェストの代わりにはなりません。それ以外の場所は `misplaced_manifest`（warning）で、宣言には数えません。

### 重複（`duplicate_manifest`）

同じ置き場所に、名前が `.xcprivacy` で終わる（大文字小文字を区別しない）ファイルが 2 つ以上あれば error です。`PrivacyInfo.xcprivacy` と `PrivacyInfo.XCPrivacy`、`PrivacyInfo 2.xcprivacy` も含みます。中の framework のマニフェストは親の重複に数えません。

`--mode project` では、同じディレクトリの重複に加え、`project.pbxproj` を解析できた場合はターゲットの Copy Bundle Resources に `.xcprivacy` が 2 つ以上あることも報告します（コピー先で衝突するため）。

### マニフェストの中身

XML / JSON / バイナリ（`bplist00`）の plist を読みます。

- `NSPrivacyAccessedAPITypeReasons` が空、または無い → `empty_reasons`（error）
- 未知のカテゴリ → `unknown_category`（error）
- 既知の理由コードだが別カテゴリのもの → `reason_category_mismatch`（error。そのコードは宣言に数えない）
- カタログに無い理由コード → `unknown_reason`（warning。検証できないだけなので宣言には数える）
- 読めない、構造が違う → `invalid_manifest`（error）

「理由付きで宣言されている」= 上の検証を通った理由コードが、そのカテゴリに 1 つ以上あることです。

### Required Reason API のカタログ

`src/required-reason-apis.ts` のカタログは、2026-11-13（Asia/Tokyo）に Apple の公式ドキュメントと照合しています。公式 URL、Swift 名と Objective-C 名の対応、載せていない記号は [docs/catalog.md](docs/catalog.md) にあります。

| カテゴリ | バイナリで確定扱い（抜粋） | 承認された理由コード |
| --- | --- | --- |
| FileTimestamp | NSFileCreationDate, NSFileModificationDate, fileModificationDate, NSURLCreationDateKey, NSURLContentModificationDateKey, getattrlist, getattrlistbulk, fgetattrlist, stat, fstat, fstatat, lstat, getattrlistat | DDA9.1, C617.1, 3B52.1, 0A2A.1 |
| SystemBootTime | systemUptime, mach_absolute_time | 35F9.1, 8FFB.1, 3D61.1 |
| DiskSpace | NSFileSystemFreeSize, NSFileSystemSize, NSURLVolumeAvailableCapacityKey（他の公式の volume キーも含む）, statfs, statvfs, fstatfs, fstatvfs, getattrlist, fgetattrlist, getattrlistat | E174.1, 85F4.1, 7D9E.1, B728.1 |
| ActiveKeyboards | activeInputModes | 3EC4.1, 54BD.1 |
| UserDefaults | NSUserDefaults | CA92.1, 1C8F.1, C56D.1, AC6B.1 |

公式の一覧から決めた規則:

- `getattrlist` / `fgetattrlist` / `getattrlistat` は FileTimestamp と DiskSpace の両方に載っています。どちらか一方を理由付きで宣言すれば足ります。`getattrlistbulk` は FileTimestamp だけです。
- `kern.boottime` と `CFPreferencesCopyAppValue` / `CFPreferencesSetAppValue` は、現行の公式タイプページに載っていないのでスキャンしません。
- `creationDate` / `modificationDate` は `--mode project` だけで使います。バイナリの strings には短すぎます。
- バイナリでは `NSUserDefaults` が確定、`UserDefaults` 単体は参考ヒット（`possible_undeclared_api`、warning）です。Swift のマングルや無関係な文字列があり得るためです。プロジェクトモードでは `UserDefaults` も確定です。
- バイナリの一致は識別子の境界を見ます。`stat` は `status` / `statistics` / `os_stat` / `stat_foo` には当たりません。先頭の `_`（`_stat`）、`$INODE64` や `@plt` のような接尾辞、Swift マングルの長さ接頭辞（`12systemUptime`）は許します。
- `nm` または `llvm-nm` が Mach-O を読めたときは、確定ヒットは未定義記号（import。`_stat`、`_stat$INODE64`、`_OBJC_CLASS_$_NSUserDefaults` など）か、`__TEXT,__objc_methname` セクションのセレクタ（`systemUptime`、`activeInputModes` など）に限る。strings にしか出ないもの、定義済みで import していない記号は参考ヒット（weak）にする。`nm` が読めないときは、従来の strings 判定に退避して見逃しを増やさない。

### 不足と未宣言

| 状況 | 結果 |
| --- | --- |
| アプリ本体（またはゆるいバンドル根）にマニフェストが無い | `missing_manifest` **error**（記号が無くても） |
| 埋め込み framework / appex / xctest にマニフェストが無く、確定記号がある | `missing_manifest` **error** |
| 埋め込み framework 等にマニフェストが無く、確定記号も無い | `missing_manifest` **warning** |
| 確定記号のカテゴリが理由付きで宣言されていない（重なる記号は、代替カテゴリも未宣言のとき） | `undeclared_api` error |
| 参考ヒット（`UserDefaults` 単体）だけで、カテゴリが未宣言 | `possible_undeclared_api` warning |

Apple のドキュメントは、Required Reason API を使う実行ファイルや dylib ごとに、それを含むバンドルがマニフェストでその API を報告すること、サードパーティ SDK はアプリ側のマニフェストに頼ってはいけないこと、も書いています。このツールは、最も近い持ち主のバンドルを見ます。

## 制限

- Linux では GNU `nm` が本物の Mach-O を読めないことがあります。その場合は内蔵の strings 抽出と、従来の strings 判定に退避します。同梱のフィクスチャはテキストの疑似バイナリで、本物の Mach-O ではありません。
- リンクされたシステムライブラリ由来の記号と、アプリ自身の呼び出しを完全には区別できません。
- `--mode project` はコメントや未使用コードも拾い得ます。
- このツールを通っても、App Store に通る保証はありません。Apple の API と理由の一覧は変わり得ます。照合した日付は [docs/catalog.md](docs/catalog.md) に書いてあります。

## ライセンス

Apache License 2.0。[LICENSE](LICENSE) と [NOTICE](NOTICE) を見てください。
