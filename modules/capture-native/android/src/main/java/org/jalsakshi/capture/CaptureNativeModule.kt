package org.jalsakshi.capture

// T04: the native BINDING that was missing.
//
// `CaptureModule` (sibling file) held the algorithm but was a plain Kotlin
// class: it did not extend Expo's `Module`, declared no `ModuleDefinition`,
// and exposed no function to JS. So even once compiled it was unreachable -
// which is the real reason `computeFeaturesNative` could only ever reject.
// This file is the bridge, not a rewrite of the algorithm.
//
// No calibration claim: every value returned here is a raw pixel statistic,
// never a water-quality or safety value (AGENTS.md).

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class CaptureNativeModule : Module() {

  private val capture = CaptureModule()

  override fun definition() = ModuleDefinition {
    Name("CaptureNative")

    /**
     * Compute the schema-v1 feature vector for a JPEG on disk.
     *
     * `corners` are the ROI quad in the UPRIGHT (EXIF orientation-1) frame,
     * ordered top-left, top-right, bottom-right, bottom-left - matching
     * docs/feature-schema.md and the JS leg exactly.
     *
     * Errors propagate as rejections with their real cause. A failure to
     * decode or a missing file must surface as a failure; it must never
     * return a plausible-looking vector.
     */
    AsyncFunction("computeFeaturesFromFile") { path: String, corners: List<Map<String, Double>>, outSize: Int ->
      val bytes = File(path).readBytes()
      val quad = corners.map { PointF64(it["x"] ?: 0.0, it["y"] ?: 0.0) }
      require(quad.size == 4) { "ROI must have exactly 4 corners, got ${quad.size}" }
      val v = capture.computeFeaturesNative(bytes, quad, outSize)
      mapOf(
        "schema_version" to v.schemaVersion,
        "roi_width" to v.roiWidth,
        "roi_height" to v.roiHeight,
        "median_r" to v.medianR,
        "median_g" to v.medianG,
        "median_b" to v.medianB,
        "sample_count" to v.sampleCount,
        "orientation_read" to v.orientationRead,
        "upright_width" to v.uprightWidth,
        "upright_height" to v.uprightHeight,
      )
    }

    /** Proves the native leg is actually linked and callable, with no image. */
    Function("isAvailable") { true }
  }
}
