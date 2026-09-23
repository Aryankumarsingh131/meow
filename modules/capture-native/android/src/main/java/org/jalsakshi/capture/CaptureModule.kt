package org.jalsakshi.capture

// T04: native (Kotlin/Android) leg of the schema-v1 capture-feature pipeline.
//
// STATUS: compiled and executed on the Android 15 x86_64 emulator. Its native
// golden result matches the Python/libjpeg leg exactly; see
// tests/capture-golden.json. A physical ARM phone and real camera JPEG remain
// outstanding, so emulator parity is not field validation.
//
// Mirrors the exact algorithm in modules/capture-native/index.ts and
// tests/capture_golden_reference.py: EXIF orientation correction (8 cases,
// only orientation 6 empirically verified by the current fixture), a
// Heckbert square-to-quad perspective sample, and per-channel median. No
// calibration claim: output is raw pixel statistics, never a water-quality
// value.

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayInputStream

data class PointF64(val x: Double, val y: Double)

data class FeatureVectorV1(
    val schemaVersion: Int = 1,
    val roiWidth: Int,
    val roiHeight: Int,
    val medianR: Double,
    val medianG: Double,
    val medianB: Double,
    val sampleCount: Int,
    val orientationRead: Int,
    val uprightWidth: Int,
    val uprightHeight: Int,
)

class CaptureModule {

    /**
     * Reads the EXIF Orientation tag (1-8) via androidx.exifinterface, the
     * same official library named in D01-adjacent research for Android
     * EXIF handling. Falls back to 1 (no correction) if absent/unreadable -
     * matching the JS/Python legs' default.
     */
    fun readExifOrientation(jpegBytes: ByteArray): Int {
        val exif = ExifInterface(ByteArrayInputStream(jpegBytes))
        return when (
            exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL,
            )
        ) {
            ExifInterface.ORIENTATION_NORMAL -> 1
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> 2
            ExifInterface.ORIENTATION_ROTATE_180 -> 3
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> 4
            ExifInterface.ORIENTATION_TRANSPOSE -> 5
            ExifInterface.ORIENTATION_ROTATE_90 -> 6
            ExifInterface.ORIENTATION_TRANSVERSE -> 7
            ExifInterface.ORIENTATION_ROTATE_270 -> 8
            else -> 1
        }
    }

    /**
     * Same index formulas as the JS/Python legs (see index.ts /
     * capture_golden_reference.py comments for derivation). `pixels` is
     * row-major [r,g,b] per pixel, matching the shared layout convention.
     */
    fun correctOrientation(
        pixels: Array<Array<IntArray>>,
        h: Int,
        w: Int,
        orientation: Int,
    ): Triple<Array<Array<IntArray>>, Int, Int> {
        return when (orientation) {
            2 -> Triple(
                Array(h) { y -> Array(w) { x -> pixels[y][w - 1 - x] } },
                h,
                w,
            )
            3 -> Triple(
                Array(h) { y -> Array(w) { x -> pixels[h - 1 - y][w - 1 - x] } },
                h,
                w,
            )
            4 -> Triple(
                Array(h) { y -> Array(w) { x -> pixels[h - 1 - y][x] } },
                h,
                w,
            )
            5 -> Triple(
                Array(w) { y -> Array(h) { x -> pixels[x][y] } },
                w,
                h,
            )
            6 -> Triple(
                Array(w) { y -> Array(h) { x -> pixels[h - 1 - x][y] } },
                w,
                h,
            )
            7 -> Triple(
                Array(w) { y -> Array(h) { x -> pixels[h - 1 - x][w - 1 - y] } },
                w,
                h,
            )
            8 -> Triple(
                Array(w) { y -> Array(h) { x -> pixels[x][w - 1 - y] } },
                w,
                h,
            )
            else -> Triple(pixels, h, w)
        }
    }

    // Not `private`: `squareToQuadCoeffs` below is public and returns it, and
    // Kotlin rejects a public function exposing a private-in-class type. This
    // was latent for as long as the file was never compiled.
    data class QuadCoeffs(
        val a: Double, val b: Double, val c: Double,
        val d: Double, val e: Double, val f: Double,
        val g: Double, val h: Double,
    )

    /** Heckbert square-to-quad projective mapping coefficients. */
    fun squareToQuadCoeffs(quad: List<PointF64>): QuadCoeffs {
        val (p0, p1, p2, p3) = quad
        val dx1 = p1.x - p2.x
        val dx2 = p3.x - p2.x
        val dx3 = p0.x - p1.x + p2.x - p3.x
        val dy1 = p1.y - p2.y
        val dy2 = p3.y - p2.y
        val dy3 = p0.y - p1.y + p2.y - p3.y

        return if (dx3 == 0.0 && dy3 == 0.0) {
            QuadCoeffs(
                a = p1.x - p0.x, b = p2.x - p1.x, c = p0.x,
                d = p1.y - p0.y, e = p2.y - p1.y, f = p0.y,
                g = 0.0, h = 0.0,
            )
        } else {
            val denom = dx1 * dy2 - dx2 * dy1
            val g = (dx3 * dy2 - dx2 * dy3) / denom
            val h = (dx1 * dy3 - dx3 * dy1) / denom
            QuadCoeffs(
                a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x, c = p0.x,
                d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y, f = p0.y,
                g = g, h = h,
            )
        }
    }

    private fun mapUnitSquareToQuad(u: Double, v: Double, c: QuadCoeffs): PointF64 {
        val denom = c.g * u + c.h * v + 1.0
        return PointF64((c.a * u + c.b * v + c.c) / denom, (c.d * u + c.e * v + c.f) / denom)
    }

    fun perspectiveSample(
        pixels: Array<Array<IntArray>>,
        h: Int,
        w: Int,
        corners: List<PointF64>,
        outSize: Int,
    ): List<IntArray> {
        val coeffs = squareToQuadCoeffs(corners)
        val samples = mutableListOf<IntArray>()
        for (j in 0 until outSize) {
            val v = (j + 0.5) / outSize
            for (i in 0 until outSize) {
                val u = (i + 0.5) / outSize
                val p = mapUnitSquareToQuad(u, v, coeffs)
                val px = p.x.toInt().coerceIn(0, w - 1)
                val py = p.y.toInt().coerceIn(0, h - 1)
                samples.add(pixels[py][px])
            }
        }
        return samples
    }

    private fun medianChannel(samples: List<IntArray>, idx: Int): Double {
        val values = samples.map { it[idx] }.sorted()
        val n = values.size
        val mid = n / 2
        return if (n % 2 == 1) values[mid].toDouble() else (values[mid - 1] + values[mid]) / 2.0
    }

    /**
     * Full pipeline: decode via android.graphics.BitmapFactory (the
     * platform decoder every Android app already depends on), then apply
     * the same EXIF-correction / homography / median steps as the other
     * two legs.
     */
    fun computeFeaturesNative(
        jpegBytes: ByteArray,
        cornersUpright: List<PointF64>,
        outSize: Int = 16,
    ): FeatureVectorV1 {
        val orientation = readExifOrientation(jpegBytes)
        val bitmap: Bitmap = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size)
            ?: throw IllegalArgumentException("BitmapFactory could not decode capture bytes")

        val storedW = bitmap.width
        val storedH = bitmap.height
        val pixels = Array(storedH) { y ->
            Array(storedW) { x ->
                val p = bitmap.getPixel(x, y)
                intArrayOf((p shr 16) and 0xFF, (p shr 8) and 0xFF, p and 0xFF)
            }
        }

        val (upright, upH, upW) = correctOrientation(pixels, storedH, storedW, orientation)
        val samples = perspectiveSample(upright, upH, upW, cornersUpright, outSize)

        return FeatureVectorV1(
            roiWidth = outSize,
            roiHeight = outSize,
            medianR = medianChannel(samples, 0),
            medianG = medianChannel(samples, 1),
            medianB = medianChannel(samples, 2),
            sampleCount = samples.size,
            orientationRead = orientation,
            uprightWidth = upW,
            uprightHeight = upH,
        )
    }
}
