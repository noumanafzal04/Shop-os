/* eslint-env jest */

// ── Native module mocks (no native code in Jest) ─────────────────────

jest.mock('react-native-keychain', () => {
  let stored = null;
  return {
    setGenericPassword: jest.fn(async (username, password) => {
      stored = { username, password };
      return true;
    }),
    getGenericPassword: jest.fn(async () => stored ?? false),
    resetGenericPassword: jest.fn(async () => {
      stored = null;
      return true;
    }),
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));

jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-screens', () => ({
  ...jest.requireActual('react-native-screens'),
  enableScreens: jest.fn(),
}));

// Native SVG has no JS renderer under Jest — stub the primitives.
jest.mock('react-native-svg', () => {
  const React = require('react');
  const stub = (name) => (props) => React.createElement(name, props, props.children);
  return {
    __esModule: true,
    default: stub('Svg'),
    Svg: stub('Svg'), Path: stub('Path'), Circle: stub('Circle'), Rect: stub('Rect'),
    G: stub('G'), Line: stub('Line'), Polyline: stub('Polyline'), Polygon: stub('Polygon'),
    Defs: stub('Defs'), LinearGradient: stub('LinearGradient'), Stop: stub('Stop'),
  };
});

// lucide exports ~1400 named icons — return a stub for ANY of them.
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const Icon = () => React.createElement('LucideIcon', null);
  return new Proxy({ __esModule: true }, { get: (t, p) => (p === '__esModule' ? true : Icon) });
});

// Geolocation is a native module — stub it (tests drive the store directly).
jest.mock('@react-native-community/geolocation', () => ({
  __esModule: true,
  default: {
    getCurrentPosition: jest.fn(),
    setRNConfiguration: jest.fn(),
    requestAuthorization: jest.fn(),
  },
}));
