package org.jalsakshi.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class QualityTest {
    private val fittedPolicy = QualityPolicy(
        minRoiPixels = 40,
        maxBlurVariance = 2637.4152,
        maxClippedFraction = 0.659722,
        maxGlareFraction = 0.149306,
    )

    @Test
    fun fixtureOutcomesMatchPythonRecord() {
        val detected = ReferenceCardState("detected", 4, 4, 3.461)
        val fixtures = listOf(
            Triple(QualityMetrics(576, 5247.0247, 0.581597, 0.0, detected), "accept", emptyList()),
            Triple(
                QualityMetrics(576, 379.9226, 0.0, 0.0, ReferenceCardState("detected", 4, 4, 0.0)),
                "review",
                listOf("BLUR_SUSPECTED"),
            ),
            Triple(
                QualityMetrics(576, 5247.0247, 0.581597, 0.0, ReferenceCardState("not_detected", 0, 4, null)),
                "retake",
                listOf("REFERENCE_CARD_NOT_DETECTED"),
            ),
            Triple(
                QualityMetrics(576, 5247.0247, 0.581597, 0.0, ReferenceCardState("partially_occluded", 2, 4, 3.464)),
                "retake",
                listOf("REFERENCE_CARD_UNREADABLE"),
            ),
            Triple(
                QualityMetrics(576, 0.0, 0.0, 0.0, ReferenceCardState("unreadable", 0, 4, null)),
                "retake",
                listOf("BLUR_SUSPECTED", "REFERENCE_CARD_UNREADABLE"),
            ),
            Triple(QualityMetrics(576, 27.8058, 0.085069, 0.0, detected), "review", listOf("BLUR_SUSPECTED")),
            Triple(QualityMetrics(576, 5542.5374, 0.439236, 0.298611, detected), "review", listOf("GLARE_EXCESSIVE")),
            Triple(QualityMetrics(576, 72297.135, 0.737847, 0.0, detected), "review", listOf("CLIPPING_EXCESSIVE")),
        )

        fixtures.forEach { (metrics, decision, reasons) ->
            val outcome = QualityRules.evaluate(metrics, fittedPolicy)
            assertEquals(decision, outcome.decision)
            assertEquals(reasons, outcome.reasons)
        }
    }

    @Test
    fun unsetThresholdsNeverAccept() {
        val outcome = QualityRules.evaluate(
            QualityMetrics(576, 5247.0247, 0.581597, 0.0, ReferenceCardState("detected", 4, 4, 3.461)),
            QualityPolicy(minRoiPixels = 40),
        )

        assertEquals("review", outcome.decision)
        assertEquals(listOf("THRESHOLD_UNSET"), outcome.reasons)
        assertEquals(
            listOf("max_blur_variance", "max_clipped_fraction", "max_glare_fraction"),
            outcome.skippedChecks,
        )
    }

    @Test
    fun referenceStatesRemainDistinct() {
        val exact = QualityRules.syntheticSwatches
        val washed = exact.mapValues { (_, pixel) ->
            IntArray(3) { channel -> (pixel[channel] + (255 - pixel[channel]) * 0.4).toInt() }
        }

        assertEquals("not_detected", QualityRules.detectReferenceCard(emptyMap()).state)
        assertEquals("detected", QualityRules.detectReferenceCard(exact).state)
        assertEquals("partially_occluded", QualityRules.detectReferenceCard(exact.filterKeys { it != "SYN-D" }).state)
        assertEquals("unreadable", QualityRules.detectReferenceCard(washed).state)
    }

    @Test
    fun imageMetricsSeparateSharpnessGlareAndClipping() {
        val flat = Array(4) { Array(4) { intArrayOf(80, 80, 80) } }
        val textured = Array(4) { y ->
            Array(4) { x -> if ((x + y) % 2 == 0) intArrayOf(0, 0, 0) else intArrayOf(200, 200, 200) }
        }
        val exposure = arrayOf(arrayOf(intArrayOf(252, 252, 252), intArrayOf(255, 255, 0)))

        assertEquals(0.0, QualityRules.blurVariance(flat), 0.0)
        assertTrue(QualityRules.blurVariance(textured) > 0.0)
        assertEquals(0.5, QualityRules.glareFraction(exposure), 0.0)
        assertEquals(0.5, QualityRules.clippedFraction(exposure), 0.0)
    }
}
