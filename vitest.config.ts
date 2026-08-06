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
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      css: false,
      restoreMocks: true,
    },
  }),
);
