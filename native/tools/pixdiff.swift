import AppKit
// pixdiff a.png b.png out.png [threshold] — writes b dimmed with differing pixels in red,
// and prints the bounding boxes (in points, @2x/2) of differing regions on a coarse grid.
let args = CommandLine.arguments
func load(_ p: String) -> CGImage { NSImage(contentsOfFile: p)!.cgImage(forProposedRect: nil, context: nil, hints: nil)! }
func pixels(_ img: CGImage) -> [UInt8] {
    var buf = [UInt8](repeating: 0, count: img.width * img.height * 4)
    let ctx = CGContext(data: &buf, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: img.width * 4,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
    return buf
}
let a = load(args[1]), b = load(args[2])
let w = min(a.width, b.width), h = min(a.height, b.height)
let pa = pixels(a), pb = pixels(b)
let threshold = args.count > 4 ? Int(args[4])! : 40
var out = [UInt8](repeating: 0, count: w * h * 4)
let cell = 40
var grid = [[Int]](repeating: [Int](repeating: 0, count: w / cell + 1), count: h / cell + 1)
var total = 0
for y in 0..<h { for x in 0..<w {
    let ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4, io = (y * w + x) * 4
    let d = abs(Int(pa[ia]) - Int(pb[ib])) + abs(Int(pa[ia+1]) - Int(pb[ib+1])) + abs(Int(pa[ia+2]) - Int(pb[ib+2]))
    if d > threshold { out[io] = 255; out[io+1] = 0; out[io+2] = 0; total += 1; grid[y / cell][x / cell] += 1 }
    else { out[io] = pb[ib] / 3; out[io+1] = pb[ib+1] / 3; out[io+2] = pb[ib+2] / 3 }
    out[io+3] = 255
}}
let ctx = CGContext(data: &out, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[3]))
print("differing pixels: \(total) (\(String(format: "%.2f", Double(total) * 100 / Double(w * h)))%)")
// Print hot cells (top-left in pt) with > 5% differing pixels.
var hot: [(Int, Int, Int)] = []
for (gy, row) in grid.enumerated() { for (gx, n) in row.enumerated() where n > cell * cell / 20 { hot.append((gx * cell / 2, gy * cell / 2, n)) } }
print("hot cells (x,y pt):", hot.prefix(60).map { "(\($0.0),\($0.1))" }.joined(separator: " "))
