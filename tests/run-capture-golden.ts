// T04 golden-vector harness (JS leg). Run with:
//   node tests/run-capture-golden.ts
// Decodes the real fixture JPEG with jpeg-js, runs computeFeaturesJs from
// modules/capture-native/index.ts, and prints timing/memory + the feature
// vector as JSON so it can be compared against the Python leg's output.

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { computeFeaturesJs, type DecodedJpeg, type Point } from "../modules/capture-native/index.ts";

const require = createRequire(import.meta.url);
const jpeg = require("jpeg-js") as {
  decode: (data: Uint8Array, opts?: { useTArray?: boolean }) => {
    width: number;
    height: number;
    data: Uint8Array; // RGBA
  };
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "fixtures", "capture-golden-source.jpg");

const CORNERS_UPRIGHT: [Point, Point, Point, Point] = [
  { x: 20, y: 15 },
  { x: 95, y: 20 },
  { x: 90, y: 75 },
  { x: 15, y: 70 },
];

function decodeJpeg(bytes: Uint8Array): DecodedJpeg {
  const raw = jpeg.decode(bytes, { useTArray: true });
  const { width, height, data } = raw; // RGBA, row-major
  const pixels: DecodedJpeg["pixels"] = [];
  for (let y = 0; y < height; y++) {
    const row: [number, number, number][] = [];
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      row.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
    pixels.push(row);
  }
  return { width, height, pixels };
}

function sha256(bytes: Uint8Array): string {
  const { createHash } = require("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

const jpegBytes = new Uint8Array(readFileSync(fixturePath));

if (global.gc) global.gc();
const memBefore = process.memoryUsage().heapUsed;
const t0 = performance.now();
const features = computeFeaturesJs(jpegBytes, decodeJpeg, CORNERS_UPRIGHT, 16);
const elapsedMs = performance.now() - t0;
const memAfter = process.memoryUsage().heapUsed;

const result = {
  language: "js",
  node_version: process.version,
  fixture_path: "tests/fixtures/capture-golden-source.jpg",
  fixture_sha256: sha256(jpegBytes),
  corners_upright: CORNERS_UPRIGHT.map((p) => [p.x, p.y]),
  expected_roi_fill_color: [120, 40, 200],
  features,
  time_ms: Math.round(elapsedMs * 10000) / 10000,
  heap_used_delta_bytes: memAfter - memBefore,
};

console.log(JSON.stringify(result, null, 2));
