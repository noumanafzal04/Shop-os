import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    svgr({
      svgrOptions: {
        icon: true,
        // This will transform your SVG to a React component
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),

    /**
     * The PWA shell.
     *
     * Two things it buys, and only one of them is "offline":
     *
     *  1. The app can be installed to a home screen and opened without a
     *     browser bar. On a counter tablet that is the difference between a
     *     till and a browser tab somebody can close by accident — and an
     *     installed app is also what persuades Chrome to grant PERSISTENT
     *     storage, which is what stops unsent sales being evicted.
     *  2. The app shell is cached, so the till opens with no network at all.
     *
     * NONE of this works over plain HTTP: a service worker only registers in a
     * secure context. `localhost` counts, a LAN IP does not, and the staging
     * droplet on http://<ip>:8080 does not either. HTTPS on a real domain is a
     * prerequisite for shipping this, not a finishing touch.
     */
    VitePWA({
      // Update in the background and let the app decide when to apply it —
      // never mid-shift. `autoUpdate` would swap the running app under a
      // cashier's hands between one sale and the next.
      registerType: "prompt",
      includeAssets: ["favicon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"],

      manifest: {
        name: "ShopOS",
        short_name: "ShopOS",
        description: "Point of sale and shop management",
        // The till fills the screen and is used in one orientation on a stand.
        display: "standalone",
        orientation: "any",
        start_url: "/tenant/pos",
        scope: "/",
        background_color: "#101828",
        theme_color: "#101828",
        // ── Real files at the sizes they claim ──────────────────────────
        //
        // All three entries used to point at `favicon.png`, which is 48x48.
        // Declaring a 48px file as 192 and 512 does not make it either: the
        // browser READS the image, finds no icon at the required sizes, and
        // quietly rules the app not installable. So the answer to "how do we
        // give the till a desktop icon" had two blockers, not one — HTTPS, and
        // an icon set that qualifies.
        //
        // `maskable` is a SEPARATE drawing, not the same file relabelled.
        // Android crops a maskable icon to whatever shape the launcher uses —
        // circle, squircle, teardrop — so the artwork must be full-bleed with
        // its content inside the middle ~60%. Handing it the rounded-square
        // logo means the corners of the badge get cut off and the mark inside
        // it with them.
        //
        // Sources kept beside the output as `images/logo/app-icon*.svg`, so
        // the next size can be re-rendered rather than re-drawn.
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },

      workbox: {
        // The whole shell, so a cold start with no network still paints.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // The bundle is large (charts, maps). A cap below it would silently
        // leave the biggest chunk uncached and the till would still need a
        // network to open — the one thing this exists to prevent.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // A deep link like /tenant/pos must resolve to the app shell offline,
        // the same way the SPA fallback resolves it on the server.
        navigateFallback: "/index.html",
        // …except for the API. Answering /api/* from the shell would hand the
        // app an HTML page where it expected JSON, which reads as a corrupt
        // response rather than as "no network".
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // API responses are NEVER cached here. What the till may use offline is
        // a deliberate projection kept in IndexedDB, decided per item type —
        // not whatever happened to be requested last.
        //
        // Product photos are the one exception, and they are not API responses:
        // they are static files the catalog points at. A food shop's POS browses
        // a visual grid, and a grid of broken images offline is worse than no
        // grid at all. Only the small squares are ever referenced — the
        // projection carries `thumb_url` and never the full-size one — so the
        // cap below is a few megabytes rather than a few hundred.
        runtimeCaching: [
          {
            urlPattern: /\/storage\/products\//,
            handler: "CacheFirst",
            options: {
              cacheName: "shopos-product-images",
              expiration: {
                // Roughly a large menu. Least-recently-used are evicted first,
                // so a shop that reorganises its catalog does not accumulate
                // pictures of things it stopped selling.
                maxEntries: 600,
                maxAgeSeconds: 30 * 24 * 60 * 60,
                purgeOnQuotaError: true,
              },
              // A photo that 404s must not be cached as a 404 for a month.
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },

      devOptions: {
        // The service worker is off in `vite dev`. Testing offline against a
        // dev server tests the dev server; `npm run build && npm run preview`
        // is the only honest local check.
        enabled: false,
      },
    }),
  ],
});
