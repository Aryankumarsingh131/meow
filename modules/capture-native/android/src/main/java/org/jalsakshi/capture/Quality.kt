package org.jalsakshi.capture

import kotlin.math.pow
import kotlin.math.sqrt

const val QUALITY_RULES_VERSION = "quality-rules-v1"

data class ReferenceCardState(
    val state: String,
    val swatchesMatched: Int,
    val swatchesExpected: Int,
    val meanDistance: Double?,
)

data class QualityMetrics(
    val roiPixelCount: Int,
    val blurVariance: Double,
    val clippedFraction: Double,
    val glareFraction: Double,
    val referenceCard: ReferenceCardState,
)

data class QualityPolicy(
    val minRoiPixels: Int? = null,
    // The protocol field is named max_blur_variance even though low variance
    // is the rejection condition. Keep the contract name here.
    val maxBlurVariance: Double? = null,
    val maxClippedFraction: Double? = null,
    val maxGlareFraction: Double? = null,
)

data class QualityOutcome(
    val decision: String,
    val reasons: List<String>,
    val metrics: QualityMetrics,
    val rulesVersion: String = QUALITY_RULES_VERSION,
    val thresholdsProvisional: Boolean = true,
    val skippedChecks: List<String> = emptyList(),
)

object QualityRules {
    val syntheticSwatches = mapOf(
        "SYN-A" to intArrayOf(0x3B, 0x82, 0xF6),
        "SYN-B" to intArrayOf(0x10, 0xB9, 0x81),
        "SYN-C" to intArrayOf(0xF5, 0x9E, 0x0B),
        "SYN-D" to intArrayOf(0xEF, 0x44, 0x44),
    )

    private fun luma(pixel: IntArray) =
        0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]

    fun blurVariance(grid: Array<Array<IntArray>>): Double {
        if (grid.size < 3 || grid[0].size < 3) return 0.0
        val values = mutableListOf<Double>()
        for (y in 1 until grid.lastIndex) {
            for (x in 1 until grid[y].lastIndex) {
                values += 4 * luma(grid[y][x]) -
                    luma(grid[y - 1][x]) - luma(grid[y + 1][x]) -
                    luma(grid[y][x - 1]) - luma(grid[y][x + 1])
            }
        }
        if (values.isEmpty()) return 0.0
        val mean = values.average()
        return values.sumOf { (it - mean).pow(2) } / values.size
    }

    fun clippedFraction(grid: Array<Array<IntArray>>): Double {
        val pixels = grid.sumOf { it.size }
        if (pixels == 0) return 0.0
        val clipped = grid.sumOf { row -> row.count { pixel -> pixel.any { it <= 0 || it >= 255 } } }
        return clipped.toDouble() / pixels
    }

    fun glareFraction(grid: Array<Array<IntArray>>): Double {
        val pixels = grid.sumOf { it.size }
        if (pixels == 0) return 0.0
        val glare = grid.sumOf { row ->
            row.count { pixel ->
                val max = pixel.max()
                val saturation = if (max == 0) 0.0 else (max - pixel.min()).toDouble() / max
                luma(pixel) >= 245 && saturation <= 0.10
            }
        }
        return glare.toDouble() / pixels
    }

    fun detectReferenceCard(
        patches: Map<String, IntArray>,
        tolerance: Double = 60.0,
        unreadableTolerance: Double = 120.0,
    ): ReferenceCardState {
        if (patches.isEmpty()) return ReferenceCardState("not_detected", 0, syntheticSwatches.size, null)

        val matched = mutableListOf<Double>()
        var near = 0
        syntheticSwatches.forEach { (key, expected) ->
            val actual = patches[key] ?: return@forEach
            val distance = sqrt(expected.indices.sumOf { (expected[it] - actual[it]).toDouble().pow(2) })
            if (distance <= tolerance) matched += distance
            else if (distance <= unreadableTolerance) near += 1
        }

        val state = when {
            matched.size == syntheticSwatches.size -> "detected"
            matched.isNotEmpty() -> "partially_occluded"
            near > 0 -> "unreadable"
            else -> "not_detected"
        }
        return ReferenceCardState(
            state,
            matched.size,
            syntheticSwatches.size,
            matched.takeIf { it.isNotEmpty() }?.average(),
        )
    }

    fun evaluate(
        metrics: QualityMetrics,
        policy: QualityPolicy,
        requireReferenceCard: Boolean = true,
    ): QualityOutcome {
        val reasons = mutableListOf<String>()
        val skipped = mutableListOf<String>()

        policy.minRoiPixels?.let {
            if (metrics.roiPixelCount < it) reasons += "ROI_TOO_SMALL"
        } ?: skipped.add("min_roi_pixels")
        policy.maxBlurVariance?.let {
            if (metrics.blurVariance < it) reasons += "BLUR_SUSPECTED"
        } ?: skipped.add("max_blur_variance")
        policy.maxClippedFraction?.let {
            if (metrics.clippedFraction > it) reasons += "CLIPPING_EXCESSIVE"
        } ?: skipped.add("max_clipped_fraction")
        policy.maxGlareFraction?.let {
            if (metrics.glareFraction > it) reasons += "GLARE_EXCESSIVE"
        } ?: skipped.add("max_glare_fraction")

        if (requireReferenceCard) {
            when (metrics.referenceCard.state) {
                "not_detected" -> reasons += "REFERENCE_CARD_NOT_DETECTED"
                "unreadable", "partially_occluded" -> reasons += "REFERENCE_CARD_UNREADABLE"
            }
        }
        if (skipped.isNotEmpty()) reasons += "THRESHOLD_UNSET"

        val decision = when {
            reasons.any { it in setOf("ROI_TOO_SMALL", "REFERENCE_CARD_NOT_DETECTED", "REFERENCE_CARD_UNREADABLE") } -> "retake"
            reasons.isNotEmpty() -> "review"
            else -> "accept"
        }
        return QualityOutcome(decision, reasons, metrics, skippedChecks = skipped)
    }
}
