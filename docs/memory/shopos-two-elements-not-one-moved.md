---
name: shopos-two-elements-not-one-moved
description: "the shop page's sticky bar is two drawn copies, never one re-parented element; and the lag was renderItem, not the bar"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-09-08T13:51:22.835Z
---

The shop detail bar was moved out of the list after two Fabric crashes
(`addViewAt … index=50 count=1`), then reported as wrong ("tab category sbse
top py q rkh"). It is **two drawn copies** again — a `kind: "cats"` row in the
list plus an absolutely positioned copy shown past a threshold.

**Why:** two elements is not what crashed. Re-parenting ONE element did.
`stickyHeaderIndices` (re-parents a virtualised row) and `Animated.event` with
the native driver on `onScroll` (starves VirtualizedList of JS scroll events)
stay banned permanently. A plain JS `onScroll` at 16ms is fine **if** it flips a
ref before calling setState — a setState per frame was the reported jank.

**How to apply:**
- The pin threshold is the HEADER's measured `layout.height`. A row's
  `onLayout` `layout.y` is always 0 because FlatList wraps each row in a cell
  container — that bug is silent (bar never appears).
- Unshifting a row in front of `jumps` requires REBUILDING the index map, not
  patching it, or every chip lands on the previous category's last product.
- The scroll lag was `renderItem` defined inline: `section` changes mid-gesture
  and `removeClippedSubviews` is off here, so the whole menu rebuilt.
  `ProductRow` is memoised.

See [[shopos-price-and-card]], [[shopos-app-on-a-real-emulator]],
[[shopos-detector-vs-rule]].
