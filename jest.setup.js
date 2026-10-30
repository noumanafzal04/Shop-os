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

/**
 * FIREBASE MESSAGING, MOCKED.
 *
 * `@react-native-firebase/messaging` ships ESM and needs a native module, so a
 * jsdom test that renders a screen cannot load it. Six suites broke the moment
 * `src/services/push.ts` started importing it for real — which is itself the
 * finding: the old file loaded Firebase through a `require` inside a try/catch,
 * so it never loaded at all, in tests OR on a phone, and push had never worked.
 *
 * Mocked rather than added to `transformIgnorePatterns`: these are tests of
 * screens, and transforming the whole Firebase tree to prove a navigator
 * renders is paying a lot for nothing. `pushIsWired` reads push.ts as TEXT for
 * the same reason.
 */
jest.mock('@react-native-firebase/messaging', () => ({
  AuthorizationStatus: { AUTHORIZED: 1, PROVISIONAL: 2, DENIED: 0, NOT_DETERMINED: -1 },
  getMessaging: () => ({}),
  getToken: jest.fn(async () => 'test-fcm-token'),
  requestPermission: jest.fn(async () => 1),
  onMessage: jest.fn(() => () => {}),
  onTokenRefresh: jest.fn(() => () => {}),
  onNotificationOpenedApp: jest.fn(() => () => {}),
  getInitialNotification: jest.fn(async () => null),
}));

/**
 * ── GESTURE HANDLER AND REANIMATED, UNDER JEST ───────────────────────
 *
 * Both are native modules with a JS façade, and the façade is the half that
 * matters here: a test that renders the side menu or a bottom sheet has to be
 * able to construct a `Gesture.Pan()` and an `useSharedValue`, not to animate
 * anything.
 *
 * `jestSetup.js` and `mock.js` are the packages' OWN stubs rather than
 * hand-written ones. A hand-written list is the `react-native-svg` lesson
 * again: it falls behind the API the app draws with, and the failure arrives
 * as "Element type is invalid" in a test about something else entirely.
 *
 * Reanimated's mock also silences the "Reanimated 2 failed to create a
 * worklet" warning, which under Jest is true and meaningless — there is no
 * UI thread to create one on.
 */
require('react-native-gesture-handler/jestSetup');
/**
 * REANIMATED, STUBBED BY HAND — and the shipped mock is the reason why.
 *
 * `react-native-reanimated/mock` looks like the answer and is not: its first
 * line is `require('./src/index')`, so it loads the REAL module, runs
 * `initializers.native.ts`, and dies in `runOnUISync` before it has mocked
 * anything. A mock that imports the thing it is mocking only works when the
 * thing it is mocking can be imported.
 *
 * Every other combination fails too, each in a way that names no package:
 *
 *   no mock, no resolver       loadUnpackersWithCode  (worklets' native entry)
 *   worklets resolver only     runOnUISync            (reanimated's own)
 *   reanimated resolver only   "not supported on web" (resolves the WEB build)
 *
 * ── It is a Proxy, and the first draft was not ───────────────────────
 *
 * That draft listed the nine exports this app calls and argued the surface
 * was "small and stable, so state it rather than proxy it". It was wrong
 * within one run: GESTURE HANDLER imports Reanimated too, and reaches for
 * internals no screen here has ever named — `useEvent` first, and whatever
 * follows it next version. The suites failed with
 * `Reanimated.useEvent is not a function`, which is the `react-native-svg`
 * lesson arriving by a different road: a hand-written list falls behind the
 * thing it mocks, and the error names neither.
 *
 * So the named entries below are the ones whose BEHAVIOUR a render depends
 * on — a shared value has to hold a value, a timing has to call back — and
 * everything else resolves to a no-op.
 *
 * What is lost: nothing under jest asserts how a sheet MOVES. Nothing did
 * before either. `feel.test.ts` reads the source, which is the honest
 * instrument for "which thread does this run on", and a phone is the honest
 * instrument for how it feels.
 */
/**
 * THE WORKLETS RUNTIME — stubbed, because BOTH of its real entry points
 * fail under jest and for opposite reasons.
 *
 *   the native build   reaches for a TurboModule and dies on
 *                      `loadUnpackersWithCode` being undefined
 *   the web build      throws on purpose: "`getUIRuntimeHolder` is not
 *                      supported on web"
 *
 * The package ships a jest RESOLVER that picks the second, which trades the
 * first error for the second — and the second arrives from Gesture Handler
 * rather than Reanimated, on a `setImmediate`, so it fails suites that never
 * rendered an animation at all.
 *
 * A Proxy rather than a list, and the opposite choice to the Reanimated stub
 * below. This app never calls into worklets directly: the names asked for
 * are whatever Reanimated and Gesture Handler happen to reach for THIS
 * version, which is not a surface worth tracking by hand. Everything
 * resolves to a no-op that returns its first argument, which is the right
 * answer for `runOnUI(fn)` and harmless for the rest.
 */
jest.mock('react-native-worklets', () => {
  const noop = (fn) => (typeof fn === 'function' ? fn : () => {});

  return new Proxy(
    {
      __esModule: true,
      isWorkletFunction: () => false,
      createWorkletRuntime: () => ({}),
      getUIRuntimeHolder: () => ({}),
      runOnUI: noop,
      runOnJS: noop,
      runOnUISync: noop,
      scheduleOnUI: noop,
      scheduleOnRN: noop,
    },
    {
      get(target, key) {
        if (key in target) return target[key];
        if (typeof key !== 'string') return undefined;
        return noop;
      },
      has: () => true,
    },
  );
});

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View, Text, ScrollView, Image } = require('react-native');

  // A shared value is an object with a `.value`. Under jest nothing reads it
  // back on another thread, so a plain box is the whole of it.
  const useSharedValue = (initial) => {
    const ref = React.useRef({ value: initial });
    return ref.current;
  };

  // The animation helpers return their TARGET and run the callback at once:
  // a test that waits for an exit must see the exit finish.
  const settle = (toValue, _config, cb) => {
    if (typeof _config === 'function') _config(true);
    else if (typeof cb === 'function') cb(true);
    return toValue;
  };

  const named = {
    __esModule: true,
    default: { View, Text, ScrollView, Image, createAnimatedComponent: (c) => c },
    useSharedValue,
    useAnimatedStyle: (fn) => fn(),
    useDerivedValue: (fn) => ({ value: fn() }),
    useAnimatedRef: () => ({ current: null }),
    useEvent: () => () => {},
    useHandler: () => ({ context: {}, doDependenciesDiffer: false }),
    withSpring: settle,
    withTiming: settle,
    withDelay: (_ms, value) => value,
    cancelAnimation: () => {},
    runOnJS: (fn) => fn,
    runOnUI: (fn) => fn,
    interpolate: (value, input, output) => {
      // Enough to be truthful at the ends, which is all any assertion here
      // looks at: a backdrop is either dimmed or it is not.
      if (value <= input[0]) return output[0];
      if (value >= input[input.length - 1]) return output[output.length - 1];
      return output[0];
    },
    Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    Easing: { linear: (t) => t, inOut: (f) => f, out: (f) => f, quad: (t) => t, cubic: (t) => t },
  };

  return new Proxy(named, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key !== 'string') return undefined;
      // Anything Gesture Handler or a future version reaches for. Returning
      // a function rather than undefined is what stops the failure being
      // "x is not a function" in a file nobody here wrote.
      return () => {};
    },
    has: () => true,
  });
});
