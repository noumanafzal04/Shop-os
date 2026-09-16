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
  /**
   * THE SHARED PACKAGE — see metro.config.js for the whole story.
   *
   * Stated here as well because jest does not read Metro's config, and a
   * mapping that exists for the bundler and not for the runner is a suite
   * that fails on a file the app ships fine.
   *
   * `moduleDirectories` is the runner's half of Metro's node_modules proxy: a
   * file under ../core importing `react-native` must find THIS app's copy,
   * not go looking in a folder that has none.
   */
  moduleNameMapper: {
    '^@cartze/core/(.*)$': '<rootDir>/../core/src/$1',
    '^@cartze/core$': '<rootDir>/../core/src/index.ts',
  },
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  // Only files that ARE tests. Shared helpers live in __tests__/support/, and
  // the default pattern would collect them as suites containing no tests.
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@react-navigation|react-native-screens|react-native-safe-area-context|@react-native-community|react-native-image-picker)/)',
  ],
};
