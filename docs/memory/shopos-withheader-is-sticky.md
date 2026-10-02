---
name: shopos-withheader-is-sticky
description: STANDING — Laravel's withHeader() sets a DEFAULT header on the test case, so a test "proving" no-header behaviour kept sending one; two false refutations of the same real bug
metadata:
  type: feedback
---

The Day & Banking all-branches bug was real, and I refuted it twice before
proving it. Both refutations were my own apparatus.

**1. Calling an action directly never runs the middleware.** I dumped
`BranchContext` after calling `OpenCashSessionAction` in a test and concluded
`scopeId()` was "not null without a header". `ResolveBranch` had never run —
I measured a context nobody had set.

**2. `withHeader()` is STICKY.** It sets a default header on the TestCase, not
a header on one call. So:

```php
$this->withHeader('X-Branch-Id', $town->id)->postJson('…/session/open', …);
$this->getJson('/api/v1/pos/day');   // STILL sending X-Branch-Id
```

Four of five assertions passed and the bug looked absent. `flushHeaders()` in
the sign-in helper and three failed exactly as predicted.

**Why:** both times the apparatus agreed with whichever answer I had set up,
and the agreement looked like evidence. A green assertion about absence is
only evidence if the thing is genuinely absent.

**How to apply:** when a test is about what happens WITHOUT something — no
header, no token, no branch, no session — make the helper that signs in also
`flushHeaders()`, and reach the subject through HTTP so the middleware runs.
Before accepting a refutation of a suspected bug, check that the measurement
could have shown the bug at all.

See [[shopos-measurement-that-lied]], [[shopos-detector-vs-rule]],
[[shopos-failed-check-is-not-a-verdict]], [[shopos-asked-as-nobody]].
