import Foundation

public enum Settings {
    // マニフェストが無いのに UserDefaults を使っている → missing_manifest
    public static var theme: String {
        get { UserDefaults.standard.string(forKey: "theme") ?? "system" }
        set { UserDefaults.standard.set(newValue, forKey: "theme") }
    }
}
