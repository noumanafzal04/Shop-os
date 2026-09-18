module.exports = {
  preset: '@react-native/jest-preset',
  /**
   * THE SHARED PACKAGE — see metro.config.js for the whole story.
   *
   * Stated here as well because jest does not read Metro's config, and a
   * mapping that exists for the bundler and not for the runner is a suite
   * that fails on a file the app ships fine.
   *
   * BOTH forms are needed and both are asserted. A single regex anchored at
   * `^@cartze/core` matches the deep form too, so the customer app once had a
   * guard that stayed green with the deep mapper deleted.
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
