---
name: shopos-offline-plan
description: "Offline POS — Phases 0-3 ALL SHIPPED including the outbox and offline selling (verified 2026-08-17, 142 outbox tests, a real offline sale rung). Only the 2-week shadow RUN remains."
metadata:
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-14T12:23:22.275Z
---

Offline POS. Branches `offline/v1/backend` and `offline/v1/admin-panel`. The
live plan is `docs/decisions/offline-pos.md` — read that first; this note only
records what is not derivable from it.

**Status as of 2026-08-14:** Phases 0-2 shipped (the 2026-07-21 note that "nothing
offline exists" is long dead). Device registry + `offline_days` per-tenant limit,
PWA shell, six-projection catalog delta sync, the TS pricing mirror with golden
fixtures rung through the real endpoint, and shadow mode with its denominator.
**CORRECTED 2026-08-17: Phase 3 IS SHIPPED.** Verified in code, not recalled —
`outbox.ts`, `flush.ts`, `offlineCheckout.ts`, `receiptNumber.ts`,
`localStock.ts` and the Reports → Offline tab all exist, 142 outbox tests pass,
and the user rang a real offline sale on 2026-08-17. This file said "has not
started" long after it had. Fifth stale memory found that day.

**What actually remains is a RUN, not a build:** the two-week shadow period
over the shop's own trading, and the admin's `offline_selling` grant (which had
no screen at all until 2026-08-17 — see [[shopos-sold-out-and-reachability]]).

The original text follows, for the reasoning it carries:

**Phase 2's exit is not mine to declare.** The build is done; the gate is two
weeks of real trading with `GET /pricing-variances` staying empty *and* the
check count proving the fortnight happened. Until the user has run that, Phase 3
must not ship.

**The principle worth carrying into Phase 3** (learned by nearly shipping without
it): a count of findings is not evidence without a count of attempts. Zero bugs
found and zero checks run look identical, and the second is the quieter one. Any
"we looked and it was clean" claim needs its denominator built at the same time,
and it must fail by **under**-claiming — store absolutes rather than accumulate,
take the newest window rather than the luckiest, and let a wiped device count
down. See [[shopos-workflow-test-rule]], which is the same instinct applied to
tests.

Related: [[shopos-build-sequence]], [[shopos-audit-backlog]], [[shopos-deployment]]
(offline needs HTTPS — service workers refuse a bare LAN IP; nip.io + certbot is
the cheap way in).
