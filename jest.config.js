/**
 * ── Why `npm test` passes --forceExit ─────────────────────────────────
 *
 * The suite finishes in about two seconds and Jest then refuses to exit for
 * five minutes. What was checked before reaching for the flag:
 *
 *   --detectOpenHandles   reports NOTHING. Jest cannot attribute the wait to
 *                         any handle a test opened.
 *   every mounted tree    now unmounts in its test, and the query client is
 *                         cleared between them.
 *   the newest listener   `useAppLinks` was disabled and the hang stayed —
 *                         so it predates this work rather than causing it.
 *
 * What is left is the React Native preset's own environment: the Animated JS
 * driver's frame scheduling keeps the loop alive after the renderer is gone.
 * That is a runner problem, not an app one, and a five-minute gate is a gate
 * people stop running.
 *
 * If this ever hides a real leak it will show up as a test that passes here and
 * misbehaves on a device — so `--detectOpenHandles` is worth re-running
 * whenever a new subscription is added.
 */
module.exports = {
  preset: '@react-native/jest-preset',
  // Only files that ARE tests. Shared helpers live in __tests__/support/, and
  // the default pattern would collect them as suites containing no tests.
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@react-navigation|react-native-screens|react-native-safe-area-context|@react-native-community)/)',
  ],
};
