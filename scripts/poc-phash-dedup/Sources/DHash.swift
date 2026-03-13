import CoreGraphics

// DHash: Gradient-based perceptual hash (comparison / fallback algorithm)
//
// Algorithm:
//   1. Resize CGImage → 9×8 grayscale using CGContext
//   2. For each row (8 rows), compare each adjacent pixel pair (8 comparisons):
//        bit = 1 if pixel[col] > pixel[col+1]
//   3. 8 rows × 8 comparisons = 64 bits → UInt64
//
// Note: dHash is faster than pHash and sensitive to local pixel gradients.
// It may produce false positives on subtle noise (cursor blink, clock tick).
// pHash's DCT focus on low-frequency structure is more robust for those cases.

final class DHash {
    private let width  = 9
    private let height = 8

    func compute(_ image: CGImage) -> UInt64 {
        guard let pixels = grayscaleBytes(image, width: width, height: height) else { return 0 }

        var hash: UInt64 = 0
        for row in 0..<height {
            for col in 0..<(width - 1) {    // 8 comparisons per row
                let left  = pixels[row * width + col]
                let right = pixels[row * width + col + 1]
                if left > right {
                    hash |= (UInt64(1) << (row * 8 + col))
                }
            }
        }
        return hash
    }

    private func grayscaleBytes(_ image: CGImage, width: Int, height: Int) -> [UInt8]? {
        let colorSpace = CGColorSpaceCreateDeviceGray()
        var data = [UInt8](repeating: 0, count: width * height)
        guard let ctx = CGContext(
            data: &data,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { return nil }

        ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return data
    }
}
