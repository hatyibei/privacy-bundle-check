import Foundation

let modified = (try? FileManager.default.attributesOfItem(atPath: "/tmp/x"))?[.modificationDate]
