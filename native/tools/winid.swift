// Usage: winid <pid>
import CoreGraphics
import Foundation
// Usage: winid <pid>  -> CGWindowID of that process's largest on-screen normal window
let pid = Int(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
var best: (Int, Double)? = nil
for w in list {
    guard (w[kCGWindowOwnerPID as String] as? Int) == pid, (w[kCGWindowLayer as String] as? Int) == 0,
          let b = w[kCGWindowBounds as String] as? [String: Double] else { continue }
    let area = (b["Width"] ?? 0) * (b["Height"] ?? 0)
    if best == nil || area > best!.1 { best = (w[kCGWindowNumber as String] as! Int, area) }
}
if let b = best { print(b.0) } else { exit(1) }
