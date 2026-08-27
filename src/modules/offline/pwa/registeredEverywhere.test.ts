import { describe, expect, it } from "vitest";

/**
 * THE ONE SCREEN BUILT TO SURVIVE AN OUTAGE HAD NO OFFLINE SHELL.
 *
 * `ServiceWorkerHost` lived in `AppLayout`. The till, the floor, the tab and
 * the kitchen board all render OUTSIDE AppLayout — so a cashier who opened
 * /tenant/pos directly, which is exactly how a till is opened, registered no
 * worker, precached nothing, and got ERR_INTERNET_DISCONNECTED on the first
 * reload after the line dropped. Reported from a real shop as "products show
 * nahi hui" once the wifi went off.
 *
 * The same class as `--pinned-bottom`: something AppLayout provides that four
 * full-screen pages never receive. It is now mounted by the wrappers that
 * cover EVERY authenticated screen — TenantThemed for the shop, AdminShell for
 * the console — and by exactly one of them at a time, because `useRegisterSW`
 * registers again on a second call.
 *
 * Source text rather than a render: this is about where a component is
 * MOUNTED, which no unit render can observe.
 */
const SOURCES = import.meta.glob("../../../{layout,common}/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const fileEnding = (suffix: string): string => {
  const hit = Object.entries(SOURCES).find(([path]) => path.endsWith(suffix));
  expect(hit, `${suffix} was not globbed — this guard is reading the wrong tree`).toBeDefined();

  return hit![1];
};

describe("every authenticated screen registers the service worker", () => {
  it("reads the files it judges", () => {
    // The denominator. A glob that breaks must fail here, not pass silently.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(3);
  });

  it("is not registered by the shell, which the till does not use", () => {
    const layout = fileEnding("layout/AppLayout.tsx");

    expect(
      /<ServiceWorkerHost\s*\/>/.test(layout),
      "AppLayout mounts ServiceWorkerHost again. The till, floor, tab and kitchen "
      + "board render outside AppLayout, so registering here leaves them with no "
      + "offline shell — and doubles the registration for every screen that IS "
      + "inside it.",
    ).toBe(false);
  });

  it("is registered by the wrapper every SHOP screen goes through", () => {
    // TenantThemed wraps /tenant entirely — panel, POS, floor, kitchen, help.
    const guards = fileEnding("common/routing/guards.tsx");
    const tenant = guards.slice(guards.indexOf("export function TenantThemed"));

    expect(
      /<ServiceWorkerHost\s*\/>/.test(tenant),
      "TenantThemed no longer registers the service worker, so a till opened at "
      + "/tenant/pos has no offline shell.",
    ).toBe(true);
  });

  it("is registered by the wrapper every ADMIN screen goes through", () => {
    const guards = fileEnding("common/routing/guards.tsx");
    const admin = guards.slice(
      guards.indexOf("export function AdminShell"),
      guards.indexOf("export function TenantThemed"),
    );

    expect(/<ServiceWorkerHost\s*\/>/.test(admin)).toBe(true);
  });
});
