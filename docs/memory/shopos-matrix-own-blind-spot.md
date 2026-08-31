---
name: shopos-matrix-own-blind-spot
description: STANDING — a matrix can share the blind spot of the tests it replaces; ShapeMatrix passed with the guard removed until an ADDRESS axis was added
metadata:
  type: feedback
---

`ShapeMatrixTest` (7 shapes × 4 stock paths) **passed with the guard removed**.

Why: it always addressed a sized product **by its size**. The bug is a caller
naming the **parent** of a product sold in sizes. Shape × path was not enough —
the missing dimension was HOW THE CALLER ADDRESSES the thing.

With a third axis (aimed at a size / aimed at the parent) the same mutation
produces eight failures: `answered 201, moved 0, expected 5`.

**How to apply:** mutation-prove every matrix before trusting it, and when the
mutation passes, ask *which axis is missing* — do not conclude the code is fine.
Axes seen so far that matter: shape, path, **address**, branch, and **date**
(two suite failures on 31 August were `subMonths` clamping onto a 30-day month).

Also: `ShapeMatrix`'s first run found a real bug — `POST .../batches` accepted a
lot on a product that does not track inventory while `adjust` refused the same
shape. A matrix earns its keep on day one.

Related: [[shopos-detector-vs-rule]], [[shopos-sizes-hold-the-stock]],
[[shopos-guards-share-a-blind-spot]].
