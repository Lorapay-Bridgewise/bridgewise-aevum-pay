module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest/setup.js'],
  // No extra moduleDirectories: viem must find its own @noble 1.x in viem/node_modules (the app uses 2.x).
  // The linked mesh SDK (../../mesh-sdk/react-native) imports react-native (the preset maps it) and,
  // once compiled, Babel's helpers: those resolve from this app.
  moduleNameMapper: {
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
  },
  testTimeout: 60_000,
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/helpers/'],
  // These packages ship modern JavaScript (ES modules) that Jest must compile first.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-async-storage|@react-navigation|@noble|@bridgewise|react-native-.*)/)',
  ],
};
