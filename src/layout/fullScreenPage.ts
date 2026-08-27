/**
 * The height of a page that runs OUTSIDE the app shell.
 *
 * The till, the floor, the tab workspace and the kitchen board fill the screen
 * themselves — no rail, no header, their own scroll panes. Because they do not
 * go through AppLayout, they also never got the one thing AppLayout does about
 * anything pinned to the bottom of the viewport.
 *
 * ── What that costs ─────────────────────────────────────────────────────
 *
 * The PWA install prompt is `fixed bottom-3` at `z-[99998]`, above everything.
 * On a page with ordinary scroll it merely sits on the content and a flick
 * brings it back — the reason `useReservesBottomRoom` exists. On a page that
 * is EXACTLY the height of the viewport there is no flick: the page ends where
 * the card begins, so whatever is pinned to the bottom of the layout is under
 * it permanently.
 *
 * On the dine-in tab that is "Running total" and the Fire-to-kitchen and
 * Settle buttons — the two things a waiter is on that screen to press.
 *
 * AppLayout pads by `--pinned-bottom`; HelpCenterPage, which is also
 * full-screen, subtracts it from its height. These four did neither, which is
 * the same rule applied to one half of the screens it belongs to.
 *
 * Exported as a constant rather than repeated, so the next full-screen page
 * cannot quietly be the fifth. `fullScreenPage.test.ts` reads the router and
 * fails when one appears that does not use it.
 */
export const FULL_SCREEN_PAGE = "h-[calc(100dvh-var(--pinned-bottom,0px))]";

/**
 * The same rule for a page that grows past the viewport rather than filling it
 * exactly — the floor, whose tables wrap onto as many rows as the shop has.
 */
export const FULL_SCREEN_PAGE_MIN = "min-h-[calc(100dvh-var(--pinned-bottom,0px))]";
