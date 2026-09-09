---
name: shopos-approximate-is-allow
description: "Android 12+ Approximate grants COARSE and denies FINE — requesting FINE alone read as a refusal on both sides of the app"
metadata:
  type: project
---

`askForLocation` in `src/services/position.ts` requests **FINE and COARSE
together** (`requestMultiple`, one dialog) and accepts EITHER.

**Why:** it requested `ACCESS_FINE_LOCATION` alone. Since Android 12 the system
dialog offers Precise/Approximate; tapping **Allow** with Approximate selected
grants COARSE and DENIES fine, so the request returned `denied` after the person
allowed it. Reported twice — a shopper with a blank pin who could not search,
and a rider who could not go online. `locationStore` had a SECOND copy of the
prompt, so one bug existed in two places; `position.ts` is now the only copy.

**How to apply:**
- `currentPosition()` returns `{ fix, why }` with `why` in
  `denied | unavailable | timeout`, and retries ONCE without high accuracy and
  with a long `maximumAge`. A high-accuracy fix waits for satellites, so indoors
  it times out — which was being reported as "check that GPS is on" about a
  phone whose GPS was on. A refusal is never retried.
- Approximate is a few hundred metres: smaller than a delivery radius, far
  smaller than a city. It answers both questions this app asks of a position.

See [[shopos-maps-location]], [[shopos-half-a-rule]], [[shopos-silent-nulls]].
