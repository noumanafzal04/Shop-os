const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * ── THE SHARED PACKAGE, AND THE THREE PLACES IT HAS TO BE DECLARED ───
 *
 * `@cartze/core` lives in a sibling folder and is consumed by ALIAS rather
 * than by `npm install`. That has to be stated here, in `jest.config.js` and
 * in `tsconfig.json` — and the three must agree, because a mapping present in
 * two of them compiles, bundles, and then fails in the third at the worst
 * possible moment. The customer app learned this the expensive way and its
 * `__tests__/coreIsWired.test.ts` asserts all three; this app carries the same
 * guard.
 *
 * `watchFolders` is what lets Metro read files outside this project at all;
 * without it the alias resolves and the bundler then refuses to serve them.
 *
 * ── Why node_modules is proxied back to this app ─────────────────────
 *
 * A file in `../core` that imports `react-native` resolves upward from ITS
 * own folder — `../core/node_modules`, then the workspace root — and never
 * finds this app's copy. The proxy sends every bare specifier here instead.
 *
 * It matters more than it looks: two copies of React in one bundle do not
 * error, they break hooks, and that reads as random re-render bugs rather
 * than as a resolution problem. With TWO apps now aliasing the same folder,
 * the proxy is also what keeps them from borrowing each other's copies.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const core = path.resolve(__dirname, '../core');

const config = {
  watchFolders: [core],
  resolver: {
    extraNodeModules: new Proxy(
      { '@cartze/core': path.resolve(core, 'src') },
      {
        get: (target, name) =>
          name in target ? target[name] : path.join(__dirname, 'node_modules', name),
      },
    ),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
