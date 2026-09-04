/**
 * ONE lock on the page behind an overlay.
 *
 * ── What the shop saw ───────────────────────────────────────────────────
 *
 * Open the menu on a tablet, drag, and the DASHBOARD moved behind it. Drag
 * inside the menu past its last item and the page moved too. Reported as
 * "sidebar scroll bhi issue kar raha / body scroll ho rahi tab pe".
 *
 * Measured in WebKit at 810 and at 390: with the drawer open,
 * `window.scrollBy(0, 400)` moved the page 400px, and `document.body`'s
 * computed `overflow` was `visible`. The drawer never locked anything. The
 * modal did — `document.body.style.overflow = "hidden"` — so half the
 * overlays in the app held the page still and half did not.
 *
 * ── Why not `overflow: hidden` ──────────────────────────────────────────
 *
 * Because that is the half-fix, and it passes a test while failing a finger.
 * `overflow: hidden` on `<body>` stops a PROGRAMMATIC `window.scrollBy` in
 * every engine, so a spec that scrolls by script goes green. iOS Safari
 * scrolls the document anyway when the touch is a real drag: the body is not
 * the scrolling element there, the viewport is. That is the exact browser the
 * shop is holding.
 *
 * Taking the body out of flow — `position: fixed`, offset up by however far
 * the page had been scrolled — leaves nothing for the viewport to scroll, on
 * every engine including that one. The offset is what stops the page jumping
 * to the top the instant the menu opens, and restoring the scroll on release
 * is what stops it jumping back down when the menu closes.
 *
 * ── Why it counts ───────────────────────────────────────────────────────
 *
 * Two owners could hold this at once — a drawer open, and a modal opened from
 * inside it. Both used to write `document.body.style.overflow` directly, so
 * whichever CLOSED first unlocked the page for the one still open. A depth
 * count means the page is released once, by the last holder.
 */

let depth = 0;
let scrollY = 0;
/** What the body looked like before the first lock, restored by the last release. */
let before: Partial<CSSStyleDeclaration> | null = null;

const KEYS = ["position", "top", "left", "right", "width", "overflow"] as const;

export function lockScroll(): void {
  if (typeof document === "undefined") return;
  depth += 1;
  if (depth > 1) return;

  const body = document.body;
  before = {};
  for (const k of KEYS) before[k] = body.style[k];

  scrollY = window.scrollY;
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
}

export function unlockScroll(): void {
  if (typeof document === "undefined") return;
  if (depth === 0) return;
  depth -= 1;
  if (depth > 0) return;

  const body = document.body;
  for (const k of KEYS) body.style[k] = (before?.[k] as string) ?? "";
  before = null;
  // Back to where the page was. Without this the page is at the top, because
  // that is where a fixed body left the viewport.
  window.scrollTo(0, scrollY);
}

/** Test seam only — a suite that mounts overlays must not leak a depth count. */
export function scrollLockDepth(): number {
  return depth;
}
