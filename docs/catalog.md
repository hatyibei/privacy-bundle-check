# Required Reason API catalog (checked 2026-11-13, Asia/Tokyo)

Sources (Apple Developer Documentation, fetched as the documentation JSON on 2026-11-13):

- [Privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)
- [Describing use of required reason API](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)
- [NSPrivacyAccessedAPIType](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype)
- [NSPrivacyAccessedAPITypeReasons](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons)
- [TN3183](https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest)
- [Adding a privacy manifest to your app or third-party SDK](https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk)
- [Placing content in a bundle](https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle)

The lists of APIs and approved reason codes now live on the `NSPrivacyAccessedAPIType` / `NSPrivacyAccessedAPITypeReasons` pages. The “Describing use of required reason API” article points there. TN3183 lists the five category strings.

## Categories and reason codes

These 5 categories and 17 reason codes match the official pages as of 2026-11-13:

| Category | Reason codes |
| --- | --- |
| NSPrivacyAccessedAPICategoryFileTimestamp | DDA9.1, C617.1, 3B52.1, 0A2A.1 |
| NSPrivacyAccessedAPICategorySystemBootTime | 35F9.1, 8FFB.1, 3D61.1 |
| NSPrivacyAccessedAPICategoryDiskSpace | E174.1, 85F4.1, 7D9E.1, B728.1 |
| NSPrivacyAccessedAPICategoryActiveKeyboards | 3EC4.1, 54BD.1 |
| NSPrivacyAccessedAPICategoryUserDefaults | CA92.1, 1C8F.1, C56D.1, AC6B.1 |

## APIs (official names → what the scanner looks for)

The official type page uses Swift names. A built binary usually contains the Objective-C constant or the C symbol, so the scanner looks for both where they name the same API.

### FileTimestamp

Official: `creationDate`, `modificationDate`, `fileModificationDate`, `contentModificationDateKey`, `creationDateKey`, `getattrlist`, `getattrlistbulk`, `fgetattrlist`, `stat`, `fstat`, `fstatat`, `lstat`, `getattrlistat`.

Binary confirmed: `NSFileCreationDate`, `NSFileModificationDate` (ObjC titles of `creationDate` / `modificationDate`), `fileModificationDate`, `NSURLCreationDateKey`, `NSURLContentModificationDateKey`, `creationDateKey`, `contentModificationDateKey`, and the C APIs above.

`creationDate` and `modificationDate` are source-only. They are too short and too common for a binary strings scan.

### SystemBootTime

Official: `systemUptime`, `mach_absolute_time()`.

`kern.boottime` is **not** on the current official type page, so this tool does not treat it as a required-reason API.

### DiskSpace

Official: `volumeAvailableCapacityKey`, `volumeAvailableCapacityForImportantUsageKey`, `volumeAvailableCapacityForOpportunisticUsageKey`, `volumeTotalCapacityKey`, `systemFreeSize`, `systemSize`, `statfs`, `statvfs`, `fstatfs`, `fstatvfs`, `getattrlist`, `fgetattrlist`, `getattrlistat`.

Binary confirmed: the official names plus the ObjC titles (`NSFileSystemFreeSize`, `NSFileSystemSize`, `NSURLVolume…`).

### Overlap

`getattrlist`, `fgetattrlist`, and `getattrlistat` are listed under **both** FileTimestamp and DiskSpace. A hit is satisfied if either category is declared with a valid reason. `getattrlistbulk` is FileTimestamp only.

### ActiveKeyboards

Official: `activeInputModes`.

### UserDefaults

Official: `UserDefaults`. The ObjC title of the same type is `NSUserDefaults`. Binary confirmed: `NSUserDefaults`. Bare `UserDefaults` in a binary is a weak (warning-only) hit because of Swift mangling and unrelated strings. In project mode, `UserDefaults` is confirmed.

`CFPreferencesCopyAppValue` and `CFPreferencesSetAppValue` are **not** on the current official type page, so they are not scanned.

## Manifest placement (official)

From “Adding a privacy manifest…” and “Placing content in a bundle”:

- iOS / iPadOS / tvOS / visionOS / watchOS app or framework: `PrivacyInfo.xcprivacy` at the bundle root (`Foo.app/PrivacyInfo.xcprivacy`, `Bar.framework/PrivacyInfo.xcprivacy`).
- macOS / Mac Catalyst app: `Contents/Resources/PrivacyInfo.xcprivacy`.
- macOS / Mac Catalyst framework: `Versions/A/Resources/PrivacyInfo.xcprivacy`.

Apple also says: for each executable or dynamic library that uses a required reason API, the bundle that includes that executable or dylib must include a privacy manifest that reports the API. A third-party SDK cannot rely on the app’s manifest to cover the SDK’s own use.

This tool does **not** claim to match App Store Connect’s own validator.
