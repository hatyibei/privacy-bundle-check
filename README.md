# privacy-bundle-check

> [!NOTE]
> Licensed under Apache-2.0. Distributed through GitHub (Action and CLI); not published on npm.

[日本語版 README はこちら / Japanese README](README.ja.md)

Check a built iOS / macOS `.app` or `.xcarchive` in CI for Privacy Manifest problems: a missing or duplicate `PrivacyInfo.xcprivacy`, and Required Reason API symbols that have no approved reason in the nearest bundle's manifest.

## Why this name

The repository is named `privacy-bundle-check`, not `privacy-manifest-check`. That exact name is already used by other public repositories, including [INNERLUXES/privacy-manifest-check](https://github.com/INNERLUXES/privacy-manifest-check), which scans *source*. This tool looks at the *built bundle*, so the name follows that difference.

## Why

Source-line scanners such as [stelabouras/privacy-manifest](https://github.com/stelabouras/privacy-manifest) can tell you what the project text looks like. They cannot see a binary SDK, and they cannot see the `PrivacyInfo.xcprivacy` file that actually landed in the archive after a copy-resources conflict.

What CI needs after a build is:

- whether the app and each embedded framework / appex still has a manifest,
- whether two xcprivacy files ended up in the same bundle directory, and
- whether Required Reason API symbols in the binary are declared, with a reason Apple lists for that category, on the bundle that owns the binary.

`privacy-bundle-check` does those three. It does **not** claim to match App Store Connect or Apple's own validator.

## Quick start

### GitHub Action

```yaml
- uses: hatyibei/privacy-bundle-check@v1
  with:
    path: build/MyApp.xcarchive
    mode: bundle
    strict: "false"
```

Inputs:

| Input | Default | Description |
|---|---|---|
| `path` | (required) | `.app`, `.xcarchive`, or a directory, relative to the workspace. |
| `mode` | `bundle` | `bundle` scans the built artifact. `project` walks source and xcprivacy (for comparison). |
| `strict` | `false` | Set to `true` to fail on warnings as well. |

Output:

| Output | Description |
|---|---|
| `exit-code` | `0`, `1`, or `2` (see [Exit codes](#exit-codes)). |

The action runs a prebuilt bundle (`dist/index.cjs`) on Node 24. Callers do not need to install dependencies or compile TypeScript.

### CLI

Requires Node.js 20 or later. The package is not on npm; run it straight from GitHub (pin a tag for reproducible runs):

```sh
npx github:hatyibei/privacy-bundle-check#v1 scan path/to/MyApp.xcarchive
npx github:hatyibei/privacy-bundle-check#v1 scan path/to/MyApp.app --json
npx github:hatyibei/privacy-bundle-check#v1 scan path/to/repo --mode project
```

Or add it as a dev dependency:

```sh
npm i -D github:hatyibei/privacy-bundle-check#v1
```

```
privacy-bundle-check scan <path> [--mode bundle|project] [--json] [--strict] [--no-external-tools]
```

| Flag | Meaning |
| --- | --- |
| `--mode bundle` | Default. Scan a built artifact. |
| `--mode project` | Walk source (`.swift`, `.m`, `.mm`, `.c`, `.h`, …) and xcprivacy. |
| `--json` | Write the report as JSON. |
| `--strict` | Exit 1 on warnings as well. |
| `--no-external-tools` | Do not call `strings` / `nm`; use the built-in string extractor. |

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No errors (warnings alone also exit 0, unless `--strict`). |
| 1 | Missing / undeclared / duplicate / invalid manifest, or similar errors. |
| 2 | Input error (path missing, a file was given, no `.app` in an `.xcarchive`, bad flags). |

## What it checks

### Bundles

- `*.xcarchive` → each `Products/Applications/*.app` (input error if none).
- `*.app` → that app.
- A directory → `*.app` / `*.xcarchive` inside it. If none, the directory is treated as a loose bundle root (for fixtures and unpackaged output).
- Inside the main bundle, `.app` / `.framework` / `.appex` / `.xctest` are listed as their own bundles. Symlinks are not followed.

Accepted manifest locations (from Apple's "Adding a privacy manifest to your app or third-party SDK" and "Placing content in a bundle"):

- iOS / iPadOS / tvOS / visionOS / watchOS: bundle root.
- macOS / Mac Catalyst app: `Contents/Resources/`.
- macOS / Mac Catalyst framework: `Versions/*/Resources/`.

A resource bundle (`*.bundle`, for example a SwiftPM `Foo_Foo.bundle`) at one of those locations contributes declarations to its owning bundle, but it does not stand in for a missing owner manifest. An xcprivacy file anywhere else is `misplaced_manifest` (warning) and is not counted as a declaration.

### Duplicates (`duplicate_manifest`)

Two or more files whose names end in `.xcprivacy` (case-insensitive) in the same manifest location are an error. That includes `PrivacyInfo.xcprivacy` next to `PrivacyInfo.XCPrivacy` or `PrivacyInfo 2.xcprivacy`. A nested framework's manifest is not counted against its parent.

In `--mode project`, the same rule applies per directory. If a `project.pbxproj` can be parsed, two or more `.xcprivacy` files in a target's Copy Bundle Resources phase are also reported (they collide at the destination).

### Manifest contents

XML, JSON, and binary (`bplist00`) plists are read.

- Empty or missing `NSPrivacyAccessedAPITypeReasons` → `empty_reasons` (error).
- Unknown category → `unknown_category` (error).
- A known reason code used on the wrong category → `reason_category_mismatch` (error; that code is not counted as a declaration).
- A reason code not in the catalog → `unknown_reason` (warning; it still counts as a declaration because this tool cannot prove it is invalid).
- Unreadable or wrongly shaped plist → `invalid_manifest` (error).

A category is "declared with a reason" when it has at least one reason code that passed the checks above.

### Required Reason API catalog

The catalog in `src/required-reason-apis.ts` was checked against Apple's documentation on 2026-11-13 (Asia/Tokyo). See [docs/catalog.md](docs/catalog.md) for the official URLs, the Swift-to-ObjC name mapping, and what was left out.

| Category | Confirmed binary symbols (excerpt) | Approved reason codes |
| --- | --- | --- |
| FileTimestamp | NSFileCreationDate, NSFileModificationDate, fileModificationDate, NSURLCreationDateKey, NSURLContentModificationDateKey, getattrlist, getattrlistbulk, fgetattrlist, stat, fstat, fstatat, lstat, getattrlistat | DDA9.1, C617.1, 3B52.1, 0A2A.1 |
| SystemBootTime | systemUptime, mach_absolute_time | 35F9.1, 8FFB.1, 3D61.1 |
| DiskSpace | NSFileSystemFreeSize, NSFileSystemSize, NSURLVolumeAvailableCapacityKey (and the other official volume keys), statfs, statvfs, fstatfs, fstatvfs, getattrlist, fgetattrlist, getattrlistat | E174.1, 85F4.1, 7D9E.1, B728.1 |
| ActiveKeyboards | activeInputModes | 3EC4.1, 54BD.1 |
| UserDefaults | NSUserDefaults | CA92.1, 1C8F.1, C56D.1, AC6B.1 |

Rules that follow from that official list:

- `getattrlist`, `fgetattrlist`, and `getattrlistat` appear under both FileTimestamp and DiskSpace. Declaring either category with a valid reason satisfies those symbols. `getattrlistbulk` is FileTimestamp only.
- `kern.boottime` and `CFPreferencesCopyAppValue` / `CFPreferencesSetAppValue` are **not** on the current official type page, so they are not scanned.
- `creationDate` and `modificationDate` are used only in `--mode project`. They are too short for a binary strings scan.
- In a binary, `NSUserDefaults` is a confirmed hit; a bare `UserDefaults` is a weak hit (`possible_undeclared_api`, warning) because of Swift mangling and unrelated strings. In project mode, `UserDefaults` is confirmed.
- Binary matches use identifier boundaries: `stat` does not match `status`, `statistics`, `os_stat`, or `stat_foo`. A leading `_` (`_stat`), suffixes such as `$INODE64` or `@plt`, and a Swift mangled length prefix (`12systemUptime`) are allowed.

### Missing manifest and undeclared API

| Situation | Result |
| --- | --- |
| The main app (or loose root) has no manifest | `missing_manifest` **error**, even with no symbols |
| An embedded framework / appex / xctest has no manifest, and a confirmed symbol is present | `missing_manifest` **error** |
| An embedded framework etc. has no manifest and no confirmed symbol | `missing_manifest` **warning** |
| A confirmed symbol's category is not declared with a reason (and, for overlapping symbols, neither alternative is declared) | `undeclared_api` error |
| Only a weak hit (bare `UserDefaults`) and the category is undeclared | `possible_undeclared_api` warning |

Apple's documentation also says that for each executable or dylib that uses a required reason API, the bundle that contains it must include a privacy manifest that reports the API, and that a third-party SDK cannot rely on the app's manifest to cover the SDK's own use. This tool checks the nearest owning bundle.

## Limits

- On Linux, `nm` often cannot read a real Mach-O. The built-in strings extractor still runs. The checked-in fixtures are text stand-ins, not real Mach-O files.
- A symbol that came from a linked system library cannot be reliably distinguished from a call the app itself makes.
- `--mode project` can pick up comments and unused code.
- Passing this tool is not a guarantee of App Store acceptance. Apple's own list of APIs and reasons can change; the catalog date is recorded in [docs/catalog.md](docs/catalog.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
