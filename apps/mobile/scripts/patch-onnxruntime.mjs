import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'onnxruntime-react-native');
const version = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).version;
if (version !== '1.24.3') throw new Error(`Review and remove the ONNX 1.24.3 patch before using ${version}`);

const gradlePath = join(packageDir, 'android', 'build.gradle');
const oldCondition = '  if (VersionNumber.parse(REACT_NATIVE_VERSION) < VersionNumber.parse("0.71")) {';
const newCondition = [
  '  def rnVersionParts = REACT_NATIVE_VERSION.split("\\\\.")',
  '  if (rnVersionParts[0].toInteger() == 0 && rnVersionParts[1].toInteger() < 71) {',
].join('\n');
const gradle = readFileSync(gradlePath, 'utf8');
if (gradle.includes(oldCondition)) writeFileSync(gradlePath, gradle.replace(oldCondition, newCondition));
else if (!gradle.includes(newCondition)) throw new Error('ONNX Gradle source changed; refusing an unknown patch');

// ponytail: remove this script after ONNX publishes its merged Gradle 9 and Expo autolinking fixes.
const legacyExpoMarker = join(packageDir, 'unimodule.json');
if (existsSync(legacyExpoMarker)) rmSync(legacyExpoMarker);
