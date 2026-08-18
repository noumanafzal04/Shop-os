---
name: shopos-tablet-chrome
description: "Tablet shell fixes 2026-08-17: ONE breakpoint (DRAWER_BELOW=1024), drawer no longer measures the header, h-dvh not h-screen. Guarded by tabletChrome.test.ts."
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
