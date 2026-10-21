import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * A STORED COPY THAT CANNOT START MENDS ITSELF.
 *
 * A deploy left the main script EMPTY on the server for a few minutes. Devices
 * that installed the service worker then kept that empty file after the server
 * was fixed — its name is its hash, so nothing looked changed — and showed a
 * white page on every load until a hard reload.
 *
 * Two menders, both read from disk and run against stand-ins:
 *  - `index.html`: a page that loaded without the app's mark throws the stored
 *    copy away and loads once more from the server;
 *  - `public/sw-heal.js`: the next worker replaces an empty stored file, or
 *    drops it, then takes over and reloads the stuck windows.
 */

const html = fs.readFileSync("index.html", "utf8");
const pageMender = /<script>\s*(\(function \(window\) \{[\s\S]*?shopos-boot-mended[\s\S]*?\}\)\(window\);)\s*<\/script>/.exec(html)?.[1] ?? "";
const workerMender = fs.readFileSync("public/sw-heal.js", "utf8");

const settle = () => new Promise((r) => setTimeout(r, 0));

function aPage({ booted = false, server = true, mendedAt = null as string | null } = {}) {
  const storage = new Map<string, string>(mendedAt ? [["shopos-boot-mended", mendedAt]] : []);
  const caches = new Set(["workbox-precache-v2-https://panel.cartze.shop/", "shopos-product-images"]);
  const registrations = [
    { active: { scriptURL: "https://panel.cartze.shop/sw.js" }, unregister: vi.fn(async () => true) },
    { active: { scriptURL: "https://panel.cartze.shop/firebase-messaging-sw.js?x=1" }, unregister: vi.fn(async () => true) },
  ];
  let onLoad: (() => void) | null = null;
  let later: (() => void) | null = null;
  const window = {
    addEventListener: (name: string, fn: () => void) => name === "load" && (onLoad = fn),
    setTimeout: (fn: () => void) => (later = fn),
    document: { documentElement: { hasAttribute: (name: string) => booted && name === "data-booted" } },
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) },
    fetch: vi.fn(async () => (server ? { ok: true } : Promise.reject(new TypeError("offline")))),
    caches: { keys: async () => [...caches], delete: async (name: string) => caches.delete(name) },
    navigator: { serviceWorker: { getRegistrations: async () => registrations } },
    location: { reload: vi.fn() },
  };
  new Function("window", pageMender)(window);
  return {
    window, caches, registrations,
    async loadAndWait() {
      onLoad?.();
      later?.();
      for (let i = 0; i < 5; i++) await settle();
    },
  };
}

describe("a page that never started", () => {
  it("is reading the real mender", () => {
    expect(pageMender).toContain("data-booted");
    expect(fs.readFileSync("src/main.tsx", "utf8")).toContain('document.documentElement.dataset.booted = "1"');
  });

  it("throws the stored copy away and loads once more from the server", async () => {
    const page = aPage();
    await page.loadAndWait();

    expect([...page.caches]).toEqual(["shopos-product-images"]);
    expect(page.registrations[0].unregister).toHaveBeenCalled();
    // The push worker is not the app's copy and keeps its registration.
    expect(page.registrations[1].unregister).not.toHaveBeenCalled();
    expect(page.window.location.reload).toHaveBeenCalledOnce();
  });

  it("does nothing when the app started", async () => {
    const page = aPage({ booted: true });
    await page.loadAndWait();
    expect(page.window.fetch).not.toHaveBeenCalled();
    expect(page.window.location.reload).not.toHaveBeenCalled();
  });

  it("keeps the copy when the server does not answer — offline it is the only one", async () => {
    const page = aPage({ server: false });
    await page.loadAndWait();
    expect(page.caches.size).toBe(2);
    expect(page.window.location.reload).not.toHaveBeenCalled();
  });

  it("keeps the copy when the server answers with an error", async () => {
    const page = aPage();
    page.window.fetch.mockImplementation(async () => ({ ok: false }));
    await page.loadAndWait();
    expect(page.caches.size).toBe(2);
    expect(page.window.location.reload).not.toHaveBeenCalled();
  });

  it("does not reload in a loop", async () => {
    const page = aPage({ mendedAt: String(Date.now() - 60_000) });
    await page.loadAndWait();
    expect(page.window.fetch).not.toHaveBeenCalled();
    expect(page.window.location.reload).not.toHaveBeenCalled();
  });
});

function aWorker(stored: Record<string, string>, server: Record<string, { body: string; type: string }>) {
  const cache = new Map(Object.entries(stored).map(([url, body]) => [url, new Response(body)]));
  const photos = new Map([["https://panel.cartze.shop/storage/products/a.js", new Response("")]]);
  const listeners: Record<string, (e: { waitUntil(p: Promise<unknown>): void }) => void> = {};
  const windows = [{ url: "https://panel.cartze.shop/tenant/pos", navigate: vi.fn(async () => null) }];
  const self = {
    addEventListener: (name: string, fn: (typeof listeners)[string]) => (listeners[name] = fn),
    skipWaiting: vi.fn(async () => {}),
    clients: { matchAll: async () => windows },
    caches: {
      keys: async () => ["workbox-precache-v2-https://panel.cartze.shop/", "shopos-product-images"],
      open: async (name: string) => {
        const m = name.includes("-precache-") ? cache : photos;
        return {
          keys: async () => [...m.keys()].map((url) => ({ url })),
          match: async (r: { url: string }) => m.get(r.url),
          put: async (r: { url: string }, res: Response) => void m.set(r.url, res),
          delete: async (r: { url: string }) => m.delete(r.url),
        };
      },
    },
  };
  const fetch = vi.fn(async (url: string) => {
    const file = server[url] ?? { body: "<!doctype html>", type: "text/html" };
    return new Response(file.body, { headers: { "content-type": file.type } });
  });
  new Function("self", "fetch", workerMender)(self, fetch);
  const run = async (name: string) => {
    let job: Promise<unknown> = Promise.resolve();
    listeners[name]?.({ waitUntil: (p) => (job = p) });
    await job;
  };
  return { self, cache, photos, windows, fetch, run };
}

describe("the next worker mends a stored copy", () => {
  it("is loaded into the service worker", () => {
    expect(fs.readFileSync("vite.config.ts", "utf8")).toContain('importScripts: ["sw-heal.js"]');
  });

  it("replaces an empty script the server still has, drops one it does not, takes over and reloads", async () => {
    const kept = "https://panel.cartze.shop/assets/vendor-AAA.js";
    const gone = "https://panel.cartze.shop/assets/index-e80xwc-S.js";
    const worker = aWorker(
      { [kept]: "", [gone]: "", "https://panel.cartze.shop/assets/index-OK.css": "body{}" },
      { [kept]: { body: "export const a = 1;", type: "application/javascript" } },
    );

    await worker.run("install");
    expect(await worker.cache.get(kept)?.clone().text()).toBe("export const a = 1;");
    // Gone from the server, which answers with the app's page instead: dropped.
    expect(worker.cache.has(gone)).toBe(false);
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();

    await worker.run("activate");
    expect(worker.windows[0].navigate).toHaveBeenCalledWith("https://panel.cartze.shop/tenant/pos");
  });

  it("leaves a sound copy waiting for the shop's own update", async () => {
    const worker = aWorker({ "https://panel.cartze.shop/assets/index-OK.js": "export {}" }, {});
    await worker.run("install");
    await worker.run("activate");
    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.self.skipWaiting).not.toHaveBeenCalled();
    expect(worker.windows[0].navigate).not.toHaveBeenCalled();
    // Only the stored app copies are looked at — not the product photos.
    expect(worker.photos.size).toBe(1);
  });
});
