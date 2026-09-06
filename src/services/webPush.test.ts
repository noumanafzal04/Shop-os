import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WHAT THIS BROWSER CAN DO, AND WHAT IT MAY BE ASKED.
 *
 * The interesting part of web push is not the token exchange — that is
 * Firebase's. It is the FIVE ways a browser can be unable to help, because
 * each of them needs a different sentence in front of a shop owner:
 *
 *   unconfigured  this build has no Firebase project. The feature does not
 *                 exist here, so offer nothing at all rather than a button
 *                 that fails.
 *   insecure      a service worker never registers over plain http. Telling
 *                 somebody to "allow notifications" would be advice that
 *                 cannot work.
 *   unsupported   no Notification API at all.
 *   denied        refused once, and a browser will NOT ask again. The only way
 *                 out is site settings, so that is what the copy has to say.
 *   default       never asked. This is the only state with a button.
 *
 * Told apart wrongly, every one of these becomes a shop owner pressing a
 * button that silently does nothing.
 */

const env = import.meta.env as Record<string, unknown>;

function withWindow(patch: Partial<Record<string, unknown>>) {
  Object.assign(globalThis, patch);
}

async function freshState() {
  vi.resetModules();
  const mod = await import("./webPush");
  return mod.pushState();
}

describe("what this browser can do", () => {
  beforeEach(() => {
    env.VITE_FIREBASE_PROJECT_ID = "cartze-test";
    env.VITE_FIREBASE_VAPID_KEY = "BFakeVapidKey";
    withWindow({
      isSecureContext: true,
      Notification: { permission: "default" },
    });
    (globalThis as unknown as { navigator: unknown }).navigator = { serviceWorker: {} };
  });

  it("offers nothing when the build has no Firebase project", async () => {
    // Not "off" — absent. A button that cannot work is worse than no button.
    env.VITE_FIREBASE_PROJECT_ID = "";
    expect(await freshState()).toBe("unconfigured");
  });

  it("offers nothing without a VAPID key either", async () => {
    // Half a config is not a config: `getToken` throws without this, and it
    // would throw from inside a button somebody pressed.
    env.VITE_FIREBASE_VAPID_KEY = "";
    expect(await freshState()).toBe("unconfigured");
  });

  it("says so over plain http rather than blaming the browser", async () => {
    // A service worker only registers in a secure context. "Allow
    // notifications" would be advice that cannot possibly work.
    withWindow({ isSecureContext: false });
    expect(await freshState()).toBe("insecure");
  });

  it("says so when the browser has no Notification API", async () => {
    withWindow({ Notification: undefined });
    expect(await freshState()).toBe("unsupported");
  });

  it("says so when there is no service worker", async () => {
    (globalThis as unknown as { navigator: unknown }).navigator = {};
    expect(await freshState()).toBe("unsupported");
  });

  it("reports a refusal as denied, which is not the same as never asked", async () => {
    // The distinction the copy turns on: a browser will not ask twice, so
    // "denied" needs different words from "default".
    withWindow({ Notification: { permission: "denied" } });
    expect(await freshState()).toBe("denied");
  });

  it("reports never-asked as default — the only state with a button", async () => {
    expect(await freshState()).toBe("default");
  });

  it("reports an existing grant", async () => {
    withWindow({ Notification: { permission: "granted" } });
    expect(await freshState()).toBe("granted");
  });
});

describe("a link a notification arrived with", () => {
  beforeEach(() => {
    env.VITE_FIREBASE_PROJECT_ID = "cartze-test";
    env.VITE_FIREBASE_VAPID_KEY = "BFakeVapidKey";
  });

  it("is read once and taken out of the address bar", async () => {
    // Left in, a refresh navigates again — and a URL copied to somebody else
    // carries their colleague's notification.
    const replaceState = vi.fn();
    withWindow({
      location: { href: "https://panel.example/?n=orders%2Fabc&x=1" },
      history: { replaceState },
    });

    vi.resetModules();
    const { takeLaunchLink } = await import("./webPush");

    expect(takeLaunchLink()).toBe("orders/abc");
    expect(replaceState).toHaveBeenCalled();

    const rewritten = replaceState.mock.calls[0][2] as string;
    expect(rewritten).not.toContain("n=");
    // …and everything else about the URL survives.
    expect(rewritten).toContain("x=1");
  });

  it("is null when there is none", async () => {
    withWindow({
      location: { href: "https://panel.example/tenant/orders" },
      history: { replaceState: vi.fn() },
    });

    vi.resetModules();
    const { takeLaunchLink } = await import("./webPush");

    expect(takeLaunchLink()).toBeNull();
  });
});
