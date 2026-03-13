import Accelerate
import CoreGraphics

// PHash: DCT-based perceptual hash (primary dedup algorithm)
//
// Algorithm:
//   1. Resize CGImage → 32×32 grayscale using CGContext
//   2. Extract pixel values as [Float] (1024 values, 0–255 range)
//   3. Apply 2D DCT via two passes of 1D vDSP DCT type II:
//        Pass 1: DCT each of the 32 rows independently
//        Pass 2: DCT each of the 32 columns of the row-DCT result
//   4. Extract top-left 8×8 submatrix (64 low-frequency coefficients)
//   5. Compute median of all 64 values
//   6. Build UInt64 hash: bit[i] = 1 if lowFreq[i] > median
//
// Hamming distance between two hashes: (a ^ b).nonzeroBitCount

final class PHash {
    private let inputSize = 32     // resize target
    private let hashSize  = 8      // 8×8 = 64 bits

    // vDSP DCT setup is expensive to create; cache it.
    // 32 = 1 * 2^5, satisfies vDSP requirement: n = f * 2^k, f ∈ {1,3,5,15}, k ≥ 4
    private let dctSetup: vDSP_DFT_Setup

    init() {
        guard let setup = vDSP_DCT_CreateSetup(nil, vDSP_Length(32), .II) else {
            fatalError("[PHash] Failed to create vDSP DCT setup for length 32")
        }
        self.dctSetup = setup
    }

    deinit {
        vDSP_DFT_DestroySetup(dctSetup)
    }

    func compute(_ image: CGImage) -> UInt64 {
        guard let pixels = grayscaleFloats(image, size: inputSize) else { return 0 }

        // --- 2D DCT: row-wise pass ---
        var afterRows = [Float](repeating: 0, count: inputSize * inputSize)
        var rowIn  = [Float](repeating: 0, count: inputSize)
        var rowOut = [Float](repeating: 0, count: inputSize)

        for row in 0..<inputSize {
            let base = row * inputSize
            rowIn = Array(pixels[base ..< base + inputSize])
            vDSP_DCT_Execute(dctSetup, &rowIn, &rowOut)
            afterRows.replaceSubrange(base ..< base + inputSize, with: rowOut)
        }

        // --- 2D DCT: column-wise pass ---
        var dct2d = [Float](repeating: 0, count: inputSize * inputSize)
        var colIn  = [Float](repeating: 0, count: inputSize)
        var colOut = [Float](repeating: 0, count: inputSize)

        for col in 0..<inputSize {
            for row in 0..<inputSize { colIn[row] = afterRows[row * inputSize + col] }
            vDSP_DCT_Execute(dctSetup, &colIn, &colOut)
            for row in 0..<inputSize { dct2d[row * inputSize + col] = colOut[row] }
        }

        // --- Extract top-left 8×8 low-frequency block ---
        var lowFreq = [Float](repeating: 0, count: hashSize * hashSize)
        for row in 0..<hashSize {
            for col in 0..<hashSize {
                lowFreq[row * hashSize + col] = dct2d[row * inputSize + col]
            }
        }

        // --- Median of 64 values ---
        let sorted = lowFreq.sorted()
        let median: Float = (sorted[31] + sorted[32]) / 2.0  // even count: average two middle values

        // --- Build 64-bit hash ---
        var hash: UInt64 = 0
        for i in 0..<(hashSize * hashSize) {
            if lowFreq[i] > median {
                hash |= (UInt64(1) << i)
            }
        }
        return hash
    }

    // Resize `image` to `size × size`, convert to grayscale, return as [Float]
    private func grayscaleFloats(_ image: CGImage, size: Int) -> [Float]? {
        let colorSpace = CGColorSpaceCreateDeviceGray()
        guard let ctx = CGContext(
            data: nil,
            width: size,
            height: size,
            bitsPerComponent: 8,
            bytesPerRow: size,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { return nil }

        ctx.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))

        guard let data = ctx.data else { return nil }
        let ptr = data.bindMemory(to: UInt8.self, capacity: size * size)
        return (0 ..< size * size).map { Float(ptr[$0]) }
    }
}
