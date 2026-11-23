// Native modules the app uses, replaced in tests.
jest.mock('react-native-keychain', () => {
  const store = new Map();
  return {
    setGenericPassword: jest.fn(async (_u, p, o) => { store.set(o.service, p); return true; }),
    getGenericPassword: jest.fn(async o => (store.has(o.service) ? { username: 'x', password: store.get(o.service) } : false)),
    resetGenericPassword: jest.fn(async o => store.delete(o.service)),
  };
});
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);
// Safe area insets come from the device: the library's own mock gives fixed ones
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// The camera is native: in tests it renders nothing
jest.mock('react-native-camera-kit', () => ({ Camera: () => null, CameraType: { Back: 'back', Front: 'front' } }));
jest.mock('@react-native-clipboard/clipboard', () => {
  let text = '';
  return { __esModule: true, default: { getString: jest.fn(async () => text), setString: jest.fn(t => { text = t; }) } };
});
