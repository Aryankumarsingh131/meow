// T04: capture-native bridge + JS reference implementation.
//
// Two things live in this one file on purpose:
//  1. `computeFeaturesJs` - a pure-JS/TS implementation of the schema-v1
//     feature pipeline. This is the reference used for cross-language golden
//     vector parity testing (see tests/capture_golden_reference.py and
//     tests/capture-golden.json), and can also serve web/dev builds where the
//     native module isn't available.
//  2. `computeFeaturesNative` - the thin bridge to the real on-device native
//     module (modules/capture-native/android/CaptureModule.kt). It is a
//     stub in this environment: no Android SDK/adb/device is available to
//     build or call the real native module (see docs/toolchain-matrix.md).
//     Calling it throws rather than silently returning a fabricated result.
//
// No calibration claim: FeatureVectorV1 is raw pixel statistics (median RGB
// of an oriented region of interest), never a water-quality/safety value.

export interface Point {
  x: number;
  y: number;
}

export interface FeatureVectorV1 {
  schema_version: 1;
  roi_width: number;
  roi_height: number;
  median_r: number;
  median_g: number;
  median_b: number;
  sample_count: number;
  orientation_read: number;
  upright_width: number;
  upright_height: number;
}

type RGB = [number, number, number];

/** pixels[y][x] = [r,g,b], row-major, matches the Python reference layout. */
type PixelGrid = RGB[][];

const EXIF_ORIENTATION_TAG = 0x0112;

/**
 * Minimal EXIF Orientation (tag 0x0112) parser operating directly on raw
 * JPEG bytes. Independent of jpeg-js's own metadata handling so this leg
 * exercises the same hand-rolled parsing logic as the Python leg, rather
 * than two different libraries' EXIF auto-magic agreeing by coincidence.
 */
export function readExifOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let pos = 2;
  while (pos < bytes.length - 4) {
    if (bytes[pos] !== 0xff) {
      pos += 1;
      continue;
    }
    const marker = bytes[pos + 1];
    if (marker === 0xe1) {
      const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
      const segStart = pos + 4;
      const isExif =
        bytes[segStart] === 0x45 &&
        bytes[segStart + 1] === 0x78 &&
        bytes[segStart + 2] === 0x69 &&
        bytes[segStart + 3] === 0x66;
      if (isExif) {
        return parseTiffOrientation(bytes.subarray(segStart + 6, pos + 2 + segLen));
      }
      pos += 2 + segLen;
    } else if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
    } else if (marker === 0xda) {
      break; // start of scan; EXIF must appear before this
    } else {
      const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
      pos += 2 + segLen;
    }
  }
  return 1;
}

function parseTiffOrientation(tiff: Uint8Array): number {
  const little = tiff[0] === 0x49 && tiff[1] === 0x49; // "II"
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d; // "MM"
  if (!little && !big) return 1;
  const read16 = (off: number) =>
    little ? tiff[off] | (tiff[off + 1] << 8) : (tiff[off] << 8) | tiff[off + 1];
  const read32 = (off: number) =>
    little
      ? (tiff[off] | (tiff[off + 1] << 8) | (tiff[off + 2] << 16) | (tiff[off + 3] << 24)) >>> 0
      : ((tiff[off] << 24) | (tiff[off + 1] << 16) | (tiff[off + 2] << 8) | tiff[off + 3]) >>> 0;

  const ifd0Offset = read32(4);
  const numEntries = read16(ifd0Offset);
  for (let i = 0; i < numEntries; i++) {
    const entryOff = ifd0Offset + 2 + i * 12;
    const tag = read16(entryOff);
    if (tag === EXIF_ORIENTATION_TAG) {
      return read16(entryOff + 8);
    }
  }
  return 1;
}

/**
 * Applies the standard EXIF orientation correction to a stored pixel grid.
 * Formulas for 2/3/4 are direct mirror/180 reflections. 6 and 8 were
 * derived and verified against numpy.rot90 on a labelled test array before
 * being ported here (see tests/capture_golden_reference.py comments); 5/7
 * are composed from the same verified primitives but are not exercised by
 * the current golden fixture (only orientation 6 is).
 */
export function correctOrientation(
  pixels: PixelGrid,
  h: number,
  w: number,
  orientation: number,
): { pixels: PixelGrid; h: number; w: number } {
  switch (orientation) {
    case 2: {
      const out: PixelGrid = Array.from({ length: h }, (_, y) =>
        Array.from({ length: w }, (_, x) => pixels[y][w - 1 - x]),
      );
      return { pixels: out, h, w };
    }
    case 3: {
      const out: PixelGrid = Array.from({ length: h }, (_, y) =>
        Array.from({ length: w }, (_, x) => pixels[h - 1 - y][w - 1 - x]),
      );
      return { pixels: out, h, w };
    }
    case 4: {
      const out: PixelGrid = Array.from({ length: h }, (_, y) =>
        Array.from({ length: w }, (_, x) => pixels[h - 1 - y][x]),
      );
      return { pixels: out, h, w };
    }
    case 5: {
      const out: PixelGrid = Array.from({ length: w }, (_, y) =>
        Array.from({ length: h }, (_, x) => pixels[x][y]),
      );
      return { pixels: out, h: w, w: h };
    }
    case 6: {
      const out: PixelGrid = Array.from({ length: w }, (_, y) =>
        Array.from({ length: h }, (_, x) => pixels[h - 1 - x][y]),
      );
      return { pixels: out, h: w, w: h };
    }
    case 7: {
      const out: PixelGrid = Array.from({ length: w }, (_, y) =>
        Array.from({ length: h }, (_, x) => pixels[h - 1 - x][w - 1 - y]),
      );
      return { pixels: out, h: w, w: h };
    }
    case 8: {
      const out: PixelGrid = Array.from({ length: w }, (_, y) =>
        Array.from({ length: h }, (_, x) => pixels[x][w - 1 - y]),
      );
      return { pixels: out, h: w, w: h };
    }
    default:
      return { pixels, h, w };
  }
}

type QuadCoeffs = [number, number, number, number, number, number, number, number];

/** Heckbert square-to-quad projective mapping coefficients. */
function squareToQuadCoeffs(quad: [Point, Point, Point, Point]): QuadCoeffs {
  const [{ x: x0, y: y0 }, { x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }] = quad;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;

  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number;
  if (dx3 === 0 && dy3 === 0) {
    a = x1 - x0;
    b = x2 - x1;
    c = x0;
    d = y1 - y0;
    e = y2 - y1;
    f = y0;
    g = 0;
    h = 0;
  } else {
    const denom = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / denom;
    h = (dx1 * dy3 - dx3 * dy1) / denom;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + h * x3;
    c = x0;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + h * y3;
    f = y0;
  }
  return [a, b, c, d, e, f, g, h];
}

function mapUnitSquareToQuad(u: number, v: number, coeffs: QuadCoeffs): Point {
  const [a, b, c, d, e, f, g, h] = coeffs;
  const denom = g * u + h * v + 1;
  return { x: (a * u + b * v + c) / denom, y: (d * u + e * v + f) / denom };
}

function perspectiveSample(
  pixels: PixelGrid,
  h: number,
  w: number,
  corners: [Point, Point, Point, Point],
  outSize: number,
): RGB[] {
  const coeffs = squareToQuadCoeffs(corners);
  const samples: RGB[] = [];
  for (let j = 0; j < outSize; j++) {
    const v = (j + 0.5) / outSize;
    for (let i = 0; i < outSize; i++) {
      const u = (i + 0.5) / outSize;
      const { x, y } = mapUnitSquareToQuad(u, v, coeffs);
      const px = Math.min(Math.max(Math.floor(x), 0), w - 1);
      const py = Math.min(Math.max(Math.floor(y), 0), h - 1);
      samples.push(pixels[py][px]);
    }
  }
  return samples;
}

function medianChannel(samples: RGB[], idx: 0 | 1 | 2): number {
  const values = samples.map((s) => s[idx]).sort((a, b) => a - b);
  const n = values.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

export interface DecodedJpeg {
  width: number;
  height: number;
  /** row-major [r,g,b] grid */
  pixels: PixelGrid;
}

/**
 * Computes the schema-v1 feature vector from raw JPEG bytes + known ROI
 * corners (already in the upright/orientation-1 frame - see
 * docs/feature-schema.md). `decodeJpeg` is injected so this function has no
 * hard dependency on any one JPEG decoder; the golden-vector harness passes
 * a jpeg-js-backed decoder.
 */
export function computeFeaturesJs(
  jpegBytes: Uint8Array,
  decodeJpeg: (bytes: Uint8Array) => DecodedJpeg,
  corners: [Point, Point, Point, Point],
  outSize = 16,
): FeatureVectorV1 {
  const orientation = readExifOrientation(jpegBytes);
  const decoded = decodeJpeg(jpegBytes);
  const { pixels: upright, h: upH, w: upW } = correctOrientation(
    decoded.pixels,
    decoded.height,
    decoded.width,
    orientation,
  );
  const samples = perspectiveSample(upright, upH, upW, corners, outSize);
  return {
    schema_version: 1,
    roi_width: outSize,
    roi_height: outSize,
    median_r: medianChannel(samples, 0),
    median_g: medianChannel(samples, 1),
    median_b: medianChannel(samples, 2),
    sample_count: samples.length,
    orientation_read: orientation,
    upright_width: upW,
    upright_height: upH,
  };
}

/**
 * Real on-device bridge. Not implemented here: no Android SDK/adb/device is
 * available in this environment to build or invoke
 * modules/capture-native/android/CaptureModule.kt. Throws rather than
 * fabricating a result - see docs/toolchain-matrix.md and
 * docs/agent-workflow/handoff-T04.md.
 */
export function computeFeaturesNative(
  fileUri: string,
  // Readonly: the bridge only reads these, and callers hold them as readonly
  // tuples (T09's `RoiCorners`).
  corners: readonly [Point, Point, Point, Point],
  outSize = 16,
): Promise<FeatureVectorV1> {
  // Required lazily, and deliberately not at module scope: this file is also
  // imported by Node test harnesses (tests/capture-flow.test.ts,
  // tests/run-capture-golden.ts) where `expo-modules-core` does not exist.
  // A top-level require would break those.
  //
  // If the native module is absent the error says so plainly. It is NEVER
  // caught and replaced with a fallback vector - a build/link failure must
  // surface as a failure, not as plausible-looking pixel statistics.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { requireNativeModule } = require("expo-modules-core");
  const native = requireNativeModule("CaptureNative");
  const path = fileUri.startsWith("file://") ? fileUri.slice("file://".length) : fileUri;
  return native.computeFeaturesFromFile(path, corners, outSize);
}

/** True only when the compiled native leg is actually linked and callable. */
export function isNativeAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireNativeModule } = require("expo-modules-core");
    return requireNativeModule("CaptureNative").isAvailable() === true;
  } catch {
    return false;
  }
}
