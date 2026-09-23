/**
 * T04 acceptance harness: runs the NATIVE leg against the same golden fixture
 * and the same known corners as the JS and Python legs, on a real device.
 *
 * Temporary verification scaffolding, not a product screen. It exists so the
 * three-way agreement claimed by tests/capture-golden.json can actually be
 * measured instead of asserted.
 */
import { Asset } from 'expo-asset';

import { computeFeaturesNative, isNativeAvailable } from '../../../modules/capture-native/index';

/** tests/capture-golden.json -> known_corners_upright */
const KNOWN_CORNERS = [
  { x: 20, y: 15 },
  { x: 95, y: 20 },
  { x: 90, y: 75 },
  { x: 15, y: 70 },
] as const;

export async function runNativeGolden(): Promise<string> {
  if (!isNativeAvailable()) return JSON.stringify({ status: 'NATIVE_MODULE_NOT_LINKED' });
  const asset = await Asset.fromModule(require('../assets/fixtures/capture-golden-source.jpg')).downloadAsync();
  const uri = asset.localUri ?? asset.uri;

  // Warm-up run excluded from timing (first call pays class-loading cost).
  await computeFeaturesNative(uri, KNOWN_CORNERS as unknown as readonly [never, never, never, never], 16);

  const runs: number[] = [];
  let features: unknown = null;
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    features = await computeFeaturesNative(uri, KNOWN_CORNERS as unknown as readonly [never, never, never, never], 16);
    runs.push(Date.now() - t0);
  }
  runs.sort((a, b) => a - b);
  return JSON.stringify({
    status: 'NATIVE_OK',
    uri,
    features,
    time_ms_median: runs[Math.floor(runs.length / 2)],
    time_ms_runs: runs,
  });
}
