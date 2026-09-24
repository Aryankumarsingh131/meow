/**
 * T26: loads the bundled model on the phone, once.
 *
 * The manifest is checked against this protocol, and the file's SHA-256
 * against the manifest, BEFORE the native runtime ever opens it. Any failure
 * (including web, where there is no native runtime) becomes a typed problem
 * that the review screen shows, never a crash and never a guess.
 */

import manifestJson from '../../assets/model-manifest.json';
import { BINS, PROTOCOL } from '../m1Protocol';
import { hex } from '../storage';
import { checkBytes, checkManifest, type ModelManifest, type ModelProblem, type ModelState } from './model';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const MODEL_ASSET = require('../../assets/syn-color-001-mlp.v1.onnx');

let loading: Promise<ModelState> | null = null;

const unavailable = (problem: ModelProblem): ModelState => ({ kind: 'unavailable', problem });

export function loadBundledModel(): Promise<ModelState> {
  loading ??= load().catch(() => unavailable('load_failed'));
  return loading;
}

async function load(): Promise<ModelState> {
  const problem = checkManifest(manifestJson, { id: PROTOCOL.id, version: PROTOCOL.version, binKeys: BINS.map((b) => b.key) });
  if (problem) return unavailable(problem);
  const manifest = manifestJson as ModelManifest;

  const [{ Asset }, { CryptoDigestAlgorithm, digest }, { File }, ort] = await Promise.all([
    import('expo-asset'), import('expo-crypto'), import('expo-file-system'), import('onnxruntime-react-native'),
  ]);
  const asset = await Asset.fromModule(MODEL_ASSET).downloadAsync();
  if (!asset.localUri) return unavailable('load_failed');
  const bytes = await new File(asset.localUri).bytes();
  const shaProblem = checkBytes(hex(await digest(CryptoDigestAlgorithm.SHA256, bytes)), manifest);
  if (shaProblem) return unavailable(shaProblem);

  const session = await ort.InferenceSession.create(asset.localUri, { executionProviders: ['cpu'] });
  return {
    kind: 'ready',
    model: {
      manifest,
      async run(rgb) {
        const feeds = { [manifest.input.name]: new ort.Tensor('float32', Float32Array.from(rgb), [1, rgb.length]) };
        const output = await session.run(feeds);
        return Array.from(output[manifest.output.name].data as Float32Array);
      },
    },
  };
}
