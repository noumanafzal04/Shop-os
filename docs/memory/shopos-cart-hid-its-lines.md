---
name: shopos-cart-hid-its-lines
description: "FIXED — a min-height inside an overflow-hidden card put 188px of the cart outside the frame on a phone; the test that should have caught it passed by scrolling a box a finger cannot scroll"
metadata:
  type: project
---

**Shop, 2026-08-19:** "i add 8,9 rows cart / on mobile and tablet showing 6,7 /
last wali rows hide ho rhi nichee".

**The bug.** The cart's scroller carried `min-h-[19rem]`. A `min-height` on a
`flex-1` child of an `overflow-hidden` card is a promise the parent cannot keep:
the child will not shrink, the parent will not grow, and the difference is **cut
off, not scrolled** — and `overflow: hidden` means no finger can reach it. On a
390×664 phone the cart pane is 128px and the floor demanded 304px: **188px of
the list lay outside the card**. Nine lines in, three visible, six unreachable.

The floor's own comment said it was there so a short basket would not make the
payment bar jump. **That bar had moved out of the card months earlier.** It was
holding nothing up.

**Also fixed:** below `sm` the catalog and cart now **take turns** behind a
Products / Cart switch (664px cannot hold two panes plus a money bar); `Disc`
and `Tax` leave the table on a phone and print on the item's sub-line when
non-zero (row 73px → 49px); the money bar's total block is a row not a tower
below `md` (248px → 177px).

**Why the tests missed it — the part worth keeping:**
- `scrollIntoViewIfNeeded` **will scroll an `overflow: hidden` box**. A finger
  will not. The check scrolled the last row into view and was told "visible"
  about content nobody can see. → `onlyWhatAFingerCanReach()` resets any scroll
  on a box that cannot be scrolled by hand, before measuring.
- `overflow-x-auto` computes **`overflow-y: auto`** too — CSS forces the other
  axis once either leaves `visible`. The row's horizontal wrapper looked like
  the cart's scroller and swallowed the scroll. Always also ask
  `scrollHeight > clientHeight`.
- The fixture had **5 sellable products**, so a nine-line cart was impossible.
  Caught only by a denominator. Shelf is now built in `e2e/shelf.setup.ts`.
- `reuseExistingServer: true` served a **stale build** — a new `data-cart-row`
  hook found nothing and the cart read as empty. **Rebuild before believing an
  e2e result.**
- `posChrome.test.ts`'s skeleton rule was keyed to `bg-white/[0.16]` and
  `bg-black/25`, tints the tiles no longer wear, so it reported "no tile
  skeleton". **A rule keyed to a colour expires the next time anyone paints** —
  key it to shape.

**How to apply:** never put a `min-h-*` on a `flex-1` child inside an
`overflow-hidden` box. When asking "can the user reach this?", reach for it the
way the user would and no other way.

Related: [[shopos-screen-testing]], [[shopos-detector-vs-rule]],
[[shopos-tablet-chrome]], [[shopos-pos-view-toggle]]
