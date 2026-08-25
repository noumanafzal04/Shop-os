import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

/**
 * Front-end tests.
 *
 * The backend suite cannot see any of this. Two whole classes of defect live
 * only here and were invisible until now:
 *
 *   - GATING. Which modules and business types see which screens is decided in
 *     the sidebar and the route table, in TypeScript. A books-only shop was
 *     being shown a Catalog it can never fill, and 1,100 green backend tests
 *     had nothing to say about it.
 *
 *   - MONEY MATHS DONE IN THE BROWSER. Change due, what is payable after a
 *     trade-in, a stocktake variance — all computed client-side, all wrong in
 *     ways a shopkeeper notices before we do.
 *
 * So the suite deliberately targets pure logic and small components, not
 * screenshots of whole pages: the point is to pin rules, not to freeze markup
 * that is still moving.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      // `e2e/*.guard.ts` too: a couple of guards read the browser specs as
      // FILES — "is every screen walked by something" — and belong beside what
      // they read rather than in `src`, which is compiled for a browser and has
      // no `node:fs`.
      //
      // `.guard.ts`, NOT `.test.ts`: Playwright's testDir is `e2e` and its
      // default match takes any `.test.ts`, so a file importing `vitest` took
      // the entire browser run down before a single browser opened — collection
      // dies while enumerating. A project-level `testIgnore` does not save it
      // either, because a project that sets its own replaces the top-level one.
      // A name Playwright never looks at cannot be swept up by one.
      include: ["src/**/*.{test,spec}.{ts,tsx}", "e2e/**/*.guard.ts"],
      css: false,
      restoreMocks: true,
    },
  }),
);
