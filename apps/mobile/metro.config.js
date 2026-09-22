const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

// Bundle the ONNX probe model as an asset (from the `meow` integration).
config.resolver.assetExts.push('onnx');

// T09: the app imports the native capture bridge from `modules/capture-native`,
// which lives at the REPO ROOT, outside Metro's default project root. Without
// this, Metro fails at runtime with "Unable to resolve module
// ../../../modules/capture-native/index" even though Node and tsc resolve it
// fine — they do not sandbox to the project root the way Metro does.
config.watchFolders = [...(config.watchFolders ?? []), path.join(repoRoot, 'modules')];

// Resolve dependencies from the app first, then the repo root, so the shared
// module can still find react/react-native without a duplicate install.
config.resolver.nodeModulesPaths = [
  path.join(projectRoot, 'node_modules'),
  path.join(repoRoot, 'node_modules'),
];

module.exports = config;
