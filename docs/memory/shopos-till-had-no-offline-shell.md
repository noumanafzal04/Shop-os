---
name: shopos-till-had-no-offline-shell
description: FIXED (live-shop report) — ServiceWorkerHost was only in AppLayout, so /tenant/pos registered NO worker; offline reload = ERR_INTERNET_DISCONNECTED
metadata:
  type: project
---

Reported from `panel.cartze.shop`: *"jab net offline kardi, products show nahi
hui saari."*

`ServiceWorkerHost` was mounted in **AppLayout**. The till, floor, tab and
kitchen board render **outside** it, so opening `/tenant/pos` directly — which
is how a till is opened — registered nothing and precached nothing.

Measured: `/tenant` → `regs: 1`; `/tenant/pos` → `regs: 0, caches: 0`; offline
reload → `net::ERR_INTERNET_DISCONNECTED`. After: `regs: 1` on the till and an
offline reload that shows shift, products and cart.

Now mounted by **TenantThemed** (all shop screens) and **AdminShell** (console)
— one each, because `useRegisterSW` registers again on a second call. Guarded by
`registeredEverywhere.test.ts`, mutation-proven.

**`offline-shift.spec.ts` "a till that reboots into an outage" had been failing
on exactly this, and I dismissed it in an earlier session as pre-existing and
environmental. It passes now.** A failing test that names the symptom precisely
is not noise — see [[shopos-failed-check-is-not-a-verdict]].

**STANDING: whatever AppLayout provides, the four full-screen pages do not get.**
Same class as [[shopos-full-screen-pinned-room]] the same day. Before adding
anything to AppLayout, ask whether the till needs it — it usually needs it most.
