import { useEffect, useState } from "react";

/**
 * A SCREEN THAT LOOKS EMPTY IS NOT THE SAME AS A SCREEN THAT SAYS WHY.
 *
 * ── The support call this exists to end ─────────────────────────────────
 *
 * A shop reported that on their iPad the dashboard's branding did not show and
 * the till's product side had no background — "background issue kar raha left
 * side product side ka". Nothing about either screen is wrong.
 *
 * This app is built with Tailwind v4, which compiles EVERY opacity modifier —
 * `bg-white/5`, `bg-brand-500/15`, `border-white/10` — to `color-mix()`. There
 * are 304 of them in the built stylesheet, plus 41 `oklch()` colours. Safari
 * learned `color-mix()` in **16.2**, and Tailwind v4 states 16.4 as its floor.
 *
 * On anything older those declarations are not "wrong", they are INVALID, and
 * an invalid declaration is dropped in silence. No error, no console warning —
 * the element simply keeps whatever it had, which is usually nothing. So the
 * surfaces disappear one by one and the page reads as broken software.
 *
 * ── Why a banner and not a polyfill ─────────────────────────────────────
 *
 * There is no honest polyfill. The colours are computed by the browser at
 * paint time from custom properties this app rewrites at runtime (per-tenant
 * branding), so "just emit a fallback" means re-deriving the whole palette in
 * JavaScript for a browser we have chosen not to support. The truthful move is
 * to SAY SO, once, where the shop can act on it.
 *
 * ── It is also the diagnosis ────────────────────────────────────────────
 *
 * Whoever reports a missing background can now answer the only question that
 * decides what to do about it — is this device too old, or is this a bug? — by
 * opening the app and looking. If the banner is there, it is the browser. If
 * it is not, it is us.
 *
 * Every style here is INLINE and every colour is a literal. A component whose
 * whole subject is "this browser cannot compute our colours" must not ask the
 * browser to compute its own.
 */

const KEY = "cartze-old-browser-dismissed";

/** Does this browser understand the colour syntax the stylesheet is built in? */
export function browserCanPaintThisApp(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;

  return (
    CSS.supports("color", "color-mix(in oklab, red 50%, transparent)")
    && CSS.supports("color", "oklch(0.5 0.1 200)")
  );
}

export default function OldBrowserNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (browserCanPaintThisApp()) return;

    try {
      if (localStorage.getItem(KEY) === "1") return;
    } catch {
      // A browser this old may also be refusing storage. Show the notice.
    }

    setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // Then it comes back next time, which is the safer of the two failures.
    }
  };

  return (
    <div
      role="status"
      style={{
        position: "relative",
        zIndex: 100003,
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "12px 16px",
        background: "#7a2e0e",
        color: "#ffffff",
        font: "600 13px/1.45 system-ui, -apple-system, sans-serif",
      }}
    >
      <span style={{ flex: "1 1 auto", minWidth: 0 }}>
        This device&rsquo;s browser is too old for CartZe, so some backgrounds,
        colours and borders will not be drawn. Everything still works and
        nothing is at risk &mdash; but on iPad or iPhone please update to
        iOS&nbsp;16.4 or newer, and on Android update Chrome.
      </span>
      <button
        type="button"
        onClick={dismiss}
        style={{
          flex: "0 0 auto",
          minHeight: "32px",
          padding: "6px 12px",
          border: "1px solid #ffffff",
          borderRadius: "8px",
          background: "transparent",
          color: "#ffffff",
          font: "600 13px/1 system-ui, -apple-system, sans-serif",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
