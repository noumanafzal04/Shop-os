# The cart that hid its own lines

**2026-08-19** · panel `src/modules/pos/pages/PosPage.tsx`, `e2e/`

## What the shop said

> i add 8,9 rows cart / on mobile and tablet showing 6,7 / last wali rows hide
> ho rhi nichee padding ni k sari rows nazr ayee

Nine lines in the cart. Six or seven on screen. The rest below the edge.

## What it actually was

Three separate faults, and only the first is a bug.

### 1 · A height floor inside a box that clips — the phone bug

The cart's scroll area carried `min-h-[19rem]`:

```jsx
<div className="min-h-[19rem] flex-1 overflow-y-auto">
```

`min-height` on a `flex-1` child **refuses to shrink**. Its parent card is
`overflow-hidden` and **refuses to grow**. The difference is not scrolled — it
is *cut off*, and `overflow: hidden` means **no finger can ever reach it**.

Measured on a 390×664 phone: the cart pane is **128px** tall, the floor demands
**304px**, so **188px of the list lay outside the card**. Nine lines went in and
**three** could be seen. The other six were not slow to find; they did not
exist as far as a hand was concerned.

The floor's own comment explained it was there so a short basket would not make
the payment bar jump. **That bar had since moved out of this card** and along the
bottom of the whole till. The floor was holding nothing up any more. It was
purely load-bearing for the defect.

### 2 · Two panes on a screen that fits one — the phone layout

664px of phone, minus a 51px top bar and a 188px money bar, leaves **425px for
the catalog and the cart together**. Splitting that fifty-fifty gives each about
a hundred pixels: one line of a nine-line sale.

Shrinking both until they equally fail to work is not a layout. Below `sm` the
two panes now **take turns** behind a Products / Cart switch, full height each,
with the Grand Total and Tender button on screen throughout — the one thing you
must never have to go and look for. From `sm` up nothing changed.

### 3 · Eight columns in 390px — the row height

Each cart row was **73px** on a phone: an eight-column table wrapping onto three
lines. `Disc` and `Tax` now step out of the table below `sm` and print on the
item's own sub-line instead, **only when they are not zero**. Nothing is hidden —
a line that has a discount still says so. Row height **73px → 49px**.

## Where the room went

| | before | after |
|---|---|---|
| tablet landscape | 9 of 9 lines | 9 of 9 |
| tablet portrait | **7 of 9** | **8 of 9**, ninth one flick away, nothing clipped |
| phone (390×664) | **3 of 9, six unreachable** | **3 of 9 visible, all 9 reachable** |

The phone number looks unchanged and is not: before, six lines were *outside the
frame with no way in*. The money bar also came down from 248px to 177px — on a
phone it had been taller than the cart and the catalog put together.

## The harness lesson, which is the bigger one

**The test I wrote to catch this passed against the bug. Three times.**

1. **Five products.** The fixture tenant had stock on five items, so the cart
   could never hold nine. Caught only by a denominator — `expect(available)
   .toBeGreaterThan(7)`. The shelf is now built explicitly in
   `e2e/shelf.setup.ts`, because a test that cannot assemble its own subject
   passes by describing something else.

2. **A stale preview server.** `reuseExistingServer: true` served the previous
   build, so a freshly added `data-cart-row` hook found nothing and the cart
   read as empty. **Rebuild before believing an e2e result.**

3. **`scrollIntoViewIfNeeded` scrolls `overflow: hidden`.** This is the one that
   matters. The check scrolled the last row into view, asked "is it visible",
   and was told **yes** — about content the shop can never see, because a
   *finger* cannot scroll an `overflow: hidden` box. **A reachability check that
   reaches by means the user does not have is not a reachability check.**

   Fixed with `onlyWhatAFingerCanReach()`: before measuring, any scroll on a box
   that cannot be scrolled by hand is put back to zero.

4. And a fourth, smaller: `overflow-x-auto` computes **`overflow-y: auto`** as
   well — CSS forces the other axis out of `visible` once either one leaves it.
   So the row's horizontal wrapper looked like the cart's scroller, accepted the
   scroll, and moved nothing. Ask `scrollHeight > clientHeight` too.

## What now pins it

- `scrollersCanReachTheirEnd` (`e2e/rules.ts`) — a scroll container whose own box
  is clipped by an ancestor has content you can scroll to and never see. Runs
  **at rest**, before anything is scrolled.
- `a full cart shows every line a cashier put in it` (`e2e/chrome.spec.ts`) —
  nine distinct products, then the last line must come fully into view by
  scrolling only what a hand can scroll.
- Two source-shape rules in `posChrome.test.ts` (the scroller carries no height
  floor; both panes carry the same phone switch), each proven red on revert.
- `posChrome.test.ts`'s skeleton rule was keyed to `bg-white/[0.16]` and
  `bg-black/25` — two tints the tiles no longer wear — so it reported "no tile
  skeleton" instead of the thing it is about. **A rule keyed to a colour expires
  the next time anyone paints.** Now keyed to shape.
