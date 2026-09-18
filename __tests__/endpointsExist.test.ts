import { fs, path, PROJECT_ROOT, codeOnly } from "./support/node";
import { serverRoutes, hasRoute } from "./support/routes";

const SERVICES = [
  "src/modules/auth/services/authService.ts",
  "src/modules/dashboard/services/dashboardService.ts",
  "src/modules/orders/services/ordersService.ts",
];

/**
 * EVERY URL THIS APP CALLS IS A ROUTE THE SERVER HAS.
 *
 * ── The bug this exists for ──────────────────────────────────────────
 *
 * Phase 1 shipped `/shop/dashboard`. The route is `/dashboard`. Nothing
 * noticed: TypeScript type-checks a string, ESLint has no opinion about one,
 * and nineteen tests passed because none of them made a request. The screen
 * would have drawn its skeleton and then "could not load", on a device, for a
 * real shop. Orders had the same mistake in the same hour — `/shop/orders`
 * against a real `/orders`. Two in two.
 *
 * ── And the bug in the FIRST version of this guard ───────────────────
 *
 * It checked each SEGMENT of a URL separately. "shop" appears somewhere in the
 * route file and so does "dashboard", so `/shop/dashboard` passed — the guard
 * was blind to the exact defect it had been written for, which is only
 * discoverable by mutating it. A path is not its words; it is its shape. See
 * `support/routes.ts`, which rebuilds the full paths the way Laravel does.
 */
describe("every endpoint the app calls exists on the server", () => {
  const routes = serverRoutes();

  it("found the server's routes", () => {
    // A parser that silently returns nothing would make every case below pass
    // vacuously — the failure mode this whole file is about.
    expect(routes.length).toBeGreaterThan(100);
  });

  it("knows a real route from an invented one", () => {
    /**
     * The guard's own proof, and it is not decoration: the segment-wise
     * version passed both of these.
     */
    expect(hasRoute(routes, "/dashboard")).toBe(true);
    expect(hasRoute(routes, "/shop/dashboard")).toBe(false);
    expect(hasRoute(routes, "/orders/X/advance")).toBe(true);
    expect(hasRoute(routes, "/order-queue")).toBe(false);
  });

  for (const file of SERVICES) {
    const name = file.split("/").slice(-1)[0]!;

    it(`${name} calls nothing the server does not have`, () => {
      const src = codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, file), "utf8"));

      const urls = [
        ...src.matchAll(/api(?:Get|Post|Put|Patch|Delete)<[^>]*>\(\s*["`](\/[^"`]+)["`]/g),
      ].map((m) => m[1]!);

      // A service with no matches means the regex stopped matching, not that
      // the file is clean. Said loudly rather than passing with nothing read.
      expect(urls.length).toBeGreaterThan(0);

      for (const url of urls) {
        // `/orders/${id}/advance` → `/orders/{}/advance`, which `hasRoute`
        // treats as a parameter segment.
        const normalised = url.replace(/\$\{[^}]+\}/g, "{}");
        expect(hasRoute(routes, normalised)).toBe(true);
      }
    });
  }
});
