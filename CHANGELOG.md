# Changelog

## 0.1.1

- When `nm` or `llvm-nm` can read a Mach-O, confirmed hits come from undefined symbols (imports) and from selectors in `__TEXT,__objc_methname`. Strings-only matches and defined-only symbols are recorded as weak hits. This removes false positives such as the word `stat` in an error string, or a defined static `__fstat` that is not a libc import.
- If `nm` cannot read the file (for example GNU nm on Linux), the previous strings-based scan is unchanged, so existing detections are not dropped.

## 0.1.0

- Initial public release.
