module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // zod v4 uses `export * as ns from '...'`, which the RN preset doesn't transform
    '@babel/plugin-transform-export-namespace-from',
  ],
};
