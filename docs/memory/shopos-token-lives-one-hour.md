---
name: shopos-token-lives-one-hour
description: STANDING — a Sanctum access token expires 1 HOUR after minting (set per token, NOT in config/sanctum.php); a full sweep is longer, and 97 "bugs" were all one dead credential
metadata:
  type: feedback
---

A full sweep run printed **849 ok · 70 to look at · 97 bugs**, and every one of
the 97 was a `401 Unauthenticated` — "hire a buyer", "add Lane 1", "the shop is
offered job presets".

**Measured before believing:** 100 of 107 cached tokens were dead, super-admin
included, while `personal_access_tokens` still held 2,290 rows. Nothing had been
deleted. And `config/sanctum.php` says `'expiration' => null`, which is why
reading it proves nothing — **the expiry is set per token, at creation:
`expires_at = created + 1 hour`.**

**A full sweep does not fit in one hour.** Tokens minted in phase A are dead by
the later phases.

**How to apply:** any long-running client against this API must treat a 401 with
a token as *my credential died*, not as a refusal — sign in again, retry once,
and if that fails return something no route ever issues so no check can read it
as an answer. `docs/qa/sweep/api.py` does this now, and `run.py` fails the run
out loud rather than printing a summary that cannot be trusted.

Third time this exact shape has cost a run: calling as nobody
([[shopos-asked-as-nobody]]), a dead agent's null verdict
([[shopos-failed-check-is-not-a-verdict]]), and now an expired credential.
**A failed check is not a verdict about the subject.**

## It bit the e2e suite too (2026-08-24)

A Playwright run competing with a backend suite on the same machine took over an
hour. The browser holds the token in `localStorage`, so once it expired **every
screen was the signed-out shell** — and the suite reported:

- "no product cards on screen — is a shift open?"
- "the till listed no sellable products"
- the a11y ratchet: **`2/5 unnamed` on EVERY screen**

That last one is the tell. A real accessibility regression varies screen to
screen; an identical figure everywhere means every screen was the same page.

**Two guards now say it out loud:** `ownerAuth()` refuses a saved session older
than 55 minutes, and `openTill()` throws if it lands on `/signin`. Both name the
expiry rather than the till.

See [[shopos-measurement-that-lied]].
