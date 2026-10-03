/* eslint-env jest */

/**
 * Native module mocks. Kept deliberately SHORTER than the customer app's:
 * this app has no geolocation (a shop does not move) and no netinfo, so
 * mocking either would be mocking something nothing imports — which reads as
 * a dependency the app has and does not.
 */

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
 * A Proxy rather than a list, and the customer app paid for that lesson: a
 * hand-written list of eleven names was missing `Ellipse`, and the failure
 * surfaced as "Element type is invalid … got: undefined" in a test about
 * something else entirely. The message names neither the module nor the
 * missing export.
 *
 * Element node types stay the real names, which is what lets a test assert on
 * `<Path d="…">`. `__esModule` and `default` are answered explicitly because
 * the interop helper reads them and must NOT get a component back.
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
      has: () => true,
    },
  );
});

/**
 * The camera — product photos are the one thing this app uploads.
 *
 * Mocked to "the person cancelled", which is the state every screen must
 * already handle, so a test that forgets to override this exercises the
 * branch most likely to be wrong rather than an imaginary happy path.
 */
jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(async () => ({ didCancel: true })),
  launchImageLibrary: jest.fn(async () => ({ didCancel: true })),
}));

/**
 * ── GESTURE HANDLER AND REANIMATED, UNDER JEST ───────────────────────
 *
 * Both are native modules with a JS façade, and the façade is the half that
 * matters here: a test that renders the drawer has to be able to construct a
 * `Gesture.Pan()`, not to animate anything.
 *
 * The packages' OWN stubs rather than hand-written ones — a hand-written list
 * falls behind the API the app uses, and the failure arrives as "Element type
 * is invalid" in a test about something else entirely.
 */
require('react-native-gesture-handler/jestSetup');
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
