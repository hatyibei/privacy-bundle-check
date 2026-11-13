import Foundation

struct FileInfo {
    // ファイルの更新日時を表示に使う（FileTimestamp / C617.1 で宣言済み）
    static func modified(_ url: URL) throws -> Date? {
        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        return attrs[.modificationDate] as? Date
    }
}
