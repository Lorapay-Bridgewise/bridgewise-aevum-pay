const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * The Bridgewise Mesh SDK (@bridgewise/mesh-react-native) is linked from ../../mesh-sdk/react-native,
 * outside this folder: Metro watches it, and resolves its imports (react-native) from here.
 *
 * Gradle output (android/build, android/app/build, android/.gradle, .cxx) holds many thousands
 * of files. On Windows without Watchman, watching them makes Metro time out with
 * "Failed to start watch mode", so they are left out here, in the app and in the SDK.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const meshSdk = path.resolve(__dirname, '../../mesh-sdk/react-native');

const ignored = [
  /[\\/]android[\\/](build|\.gradle|\.cxx|\.kotlin)[\\/].*/,
  /[\\/]android[\\/]app[\\/](build|\.cxx)[\\/].*/,
  /[\\/]ios[\\/](build|Pods)[\\/].*/,
  /[\\/]\.git[\\/].*/,
];

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [meshSdk],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    // npm links the SDK with a Windows junction holding an absolute path, which can name another
    // drive (a subst drive such as B:). Metro only serves files under its own root and watch
    // folders, so the SDK is always taken from its folder next to this repository instead.
    resolveRequest: (context, moduleName, platform) =>
      context.resolveRequest(context, moduleName === '@bridgewise/mesh-react-native' ? meshSdk : moduleName, platform),
    blockList: ignored,
  },
});
