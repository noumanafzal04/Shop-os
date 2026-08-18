---
name: shopos-tablet-chrome
description: "Tablet shell fixes: ONE breakpoint (DRAWER_BELOW=1024), drawer no longer measures the header, h-dvh not h-screen, and the Appearance panel now opens ABOVE the chrome. Guarded by tabletChrome.test.ts."
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-17T11:50:41.312Z
---

**Four tablet complaints, two causes, both "a number written down more than
once".** `docs/decisions/shopos-tablet-chrome.md`.

1. **Three widths for one question** — `SidebarContext` 768, `AppHeader` 1024,
   CSS `lg:` 1024. The 768–1023 gap **is a tablet in portrait** (iPad 820, Pro
   834, 10.2" 810). Now `DRAWER_BELOW = 1024` is exported from
   `SidebarContext` and read everywhere.
2. **The drawer measured the header** (`mt-16 h-[calc(100dvh-4rem)]`). Below
   `lg` the header is 64px shut / ~140 with the account menu open — and on a
   tablet that menu is the only route to notifications/branch/profile. Now
   `inset-y-0 h-dvh`, above the header, with its own X, closing on navigation.
3. **`h-screen` on a flex column ending in Save** (ThemeCustomizer). `100vh` is
   the LARGE viewport; the footer laid out below the glass and the middle is the
   only scroller. → `h-dvh`.

**Why:** three copies of a layout width at three values is not a style problem,
it is a device the product does not work on.

**How to apply:** a width that decides layout is stated **once**; anything that
needs it reads it. Panels with a footer use `h-dvh`, never `h-screen`. Guard is
`src/layout/tabletChrome.test.ts` (10 source-text assertions, mutation-checked).

Also landed: hover-to-peek gated on `(hover: hover) and (pointer: fine)` (touch
fires `mouseenter` with no `mouseleave`), and the pinned rail starts collapsed
below 1280.

**Still unverified visually** — Chrome tools were disconnected; all of it was
read from source, not rendered.

Related: [[shopos-mobile-design]], [[shopos-ui-conventions]], [[shopos-pos-view-toggle]].

**2026-08-18 — three more, still one number.** The Appearance canvas sat at
`z-60/70/80` while the shell sits at header `99999`, drawer backdrop `100001`,
drawer `100002`. On a tablet it opened UNDERNEATH both, which produced three
separate complaints — the close X untappable under the header, the sidebar over
the body, the header running across from the left. Scrim is now `z-100003`, the
canvas `z-100004`; the rail button stays low on purpose (a launcher belongs
behind a dialog). The scrim matters as much as the panel: one ranking below the
header leaves the header live and tappable in front of a modal.

**How to apply:** every tablet complaint in this file has been the same shape —
one question answered in more than one place, and the answers drifted. None
errored; all were invisible on the machine they were built on. When adding any
fixed/overlay element, place it in the shell's existing band, never a fresh one.

**2026-08-18 (later) — four more, all invisible on a desktop.** Appearance close
was a 28px target at the glass edge (now `size-11` = 44px, `shrink-0`); POS tiles
were `bg-white/[0.10]` on the `#212a45` pane — four percent of luminance, which
the shop read as "transparent, text showing through" (now `0.16`, hover `0.24`,
border raised); the totals bar tightens below `lg`; quick keys are `hidden
lg:block` on request — **the trade is real**: a mart's loose lines (tomatoes,
rice by the kilo) have no barcode and that strip was the fast route to them.

**And `Modal` had no shadow at all** — a white sheet on a white page behind a 30%
scrim, reported as modals "not opening properly". Now `shadow-2xl ring-1`
(the ring is what separates two dark surfaces, where a shadow does nothing) and
the scrim is 50% / 65%. **No blur** — the earlier finding that a 32px
`backdrop-blur` made every open feel sluggish still stands; the objection was to
the blur, not the opacity.

