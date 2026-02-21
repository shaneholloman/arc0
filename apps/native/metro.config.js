const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const uniwindRoot = path.dirname(require.resolve('uniwind/package.json'));

const config = getDefaultConfig(projectRoot);

// Watch monorepo root for pnpm hoisted packages while keeping Expo defaults.
config.watchFolders = [...new Set([...(config.watchFolders ?? []), monorepoRoot])];

// Help Metro resolve packages in pnpm monorepo structure
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Ensure all react imports resolve to the same instance (fixes "Invalid hook call" on web)
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-dom': path.resolve(projectRoot, 'node_modules/react-dom'),
};

// SVG support
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};
config.resolver.assetExts = [...config.resolver.assetExts.filter((ext) => ext !== 'svg'), 'wasm'];
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

// Force Uniwind to use ESM web component entrypoints to avoid CJS/web lazy-export cycles.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    if (moduleName === 'uniwind') {
      moduleName = path.join(uniwindRoot, 'dist/module/index.js');
    } else if (moduleName === 'uniwind/components') {
      moduleName = path.join(uniwindRoot, 'dist/module/components/index.js');
    } else if (moduleName.startsWith('uniwind/components/')) {
      const componentName = moduleName.slice('uniwind/components/'.length);
      moduleName = path.join(uniwindRoot, `dist/module/components/web/${componentName}.js`);
    }
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withUniwindConfig(config, {
  // relative path to your global.css file (from previous step)
  cssEntryFile: './global.css',
  // (optional) path where we gonna auto-generate typings
  // defaults to project's root
  dtsFile: './uniwind-types.d.ts',
});
