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

/**
 * Native SVG has no JS renderer under Jest — stub the primitives.
 *
 * ── Why a Proxy rather than a list ───────────────────────────────────
 *
 * This was a hand-written list of eleven names, and `Ellipse` was not on it.
 * Drawing a stack of coins turned it into `undefined`, and React reported:
 *
 *     Element type is invalid: expected a string … but got: undefined.
 *     Check the render method of `Art`.
 *
 * — in a test about a signed-out visitor reaching a shop page. The message
 * names neither the module nor the missing export, so the cost of a short list
 * is not the missing line, it is the twenty minutes spent in the wrong file.
 *
 * A Proxy makes every primitive resolve, so the mock cannot fall behind what
 * the app draws with. Element node types are still the real names, which is
 * what lets tests assert on `<Path d="…">`.
 *
 * `__esModule` and `default` are answered explicitly because the interop
 * helper reads them and must NOT get a component back.
 */
jest.mock('react-native-svg', () => {
  const React = require('react');
  const stub = (name) => (props) => React.createElement(name, props, props.children);
  const cache = new Map();

  return new Proxy(
    {},
    {
      get(_t, key) {
        if (key === '__esModule') return true;
        if (typeof key !== 'string') return undefined;
        if (key === 'default') key = 'Svg';
        if (!cache.has(key)) cache.set(key, stub(key));

        return cache.get(key);
      },
      // Jest and the interop helper both probe with `in`.
      has: () => true,
    },
  );
});

// The lucide mock is gone with the package. Every icon in this app is now
// Phosphor path data in `src/common/ui/icons` — plain components over the
// `react-native-svg` stub above, so there is nothing left to mock and the
// tests that assert on <Path d="…"> can see the real drawings.

// Geolocation is a native module — stub it (tests drive the store directly).
jest.mock('@react-native-community/geolocation', () => ({
  __esModule: true,
  default: {
    getCurrentPosition: jest.fn(),
    setRNConfiguration: jest.fn(),
    requestAuthorization: jest.fn(),
  },
}));

/**
 * The camera.
 *
 * `react-native-image-picker` is a native module: under Jest it has no
 * TurboModule behind it, and its own source ships untranspiled. Mocked to
 * "the person cancelled", which is the state every screen must already
 * handle — so a test that forgets to override this exercises the branch
 * most likely to be wrong rather than an imaginary happy path.
 */
jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(async () => ({ didCancel: true })),
  launchImageLibrary: jest.fn(async () => ({ didCancel: true })),
}));
