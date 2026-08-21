---
name: shopos-offline-drawer-in-a-browser
description: "2026-08-21: the offline shift 'still owed' list was 3/5 STALE — already built. What was missing: none of it had run in a browser. Driving it found 4 fixes, incl. the shared Modal having no role=dialog and a phone notice rendered into the pane nobody was looking at"
metadata:
  node_type: memory
  type: project
---

**2026-08-21.** `docs/decisions/shopos-offline-shift-gap.md` listed five things
still owed. **Three were already built and the document did not know it** —
`shiftQueue`, `offlineShift`, `flushShifts`, `PosShiftSyncController`, wired into
`usePos` + `pullNow`, 13 backend tests green.

> **A "still owed" list is a claim, and a claim goes stale.** Read the code
> before believing your own notes. (Twice in one week a doc was more pessimistic
> than the repo — see [[shopos-admin-side-backlog]].)

**What was actually missing: none of it had ever run in a browser.** jsdom says
`navigator.onLine === true` regardless, so every offline unit test is an online
test in costume — see [[shopos-offline-never-reachable]] and
[[shopos-offline-in-a-browser]] (5 bugs last time).

`e2e/offline-shift.spec.ts` — reboot with no line → open a drawer → sell → count
it out → sync → **ask the SERVER**. Passes on all 4 viewports. Mutation-proven
(cut the close flush → *"the shift reached the server but is still open"*).

## The four fixes it cost

1. **The shared `Modal` had no `role="dialog"`** — every modal in the app an
   anonymous div; close button an icon announced as "button". Also made the app
   untestable by role: **a test asking for the dialog it had just opened timed
   out after five minutes, which is how this was found.**
2. **A notice raised in the Cart was invisible on a phone.** The till's one way
   of speaking lived in the PRODUCTS pane; a phone shows one pane at a time. Not
   hidden by a breakpoint, not missing — **somewhere else, which from the
   counter is the same thing.** Now drawn once per layout with
   `data-pos-notice`. **Found by the 390-point project and by nothing else.**
3. **Ten identical denomination boxes, all announced as "0"** — on the screen
   where a shop counts its own cash. `aria-label="How many 500 notes"`.
4. **"No held sales" is a FALSE statement offline** — a shop may have ten parked
   tickets; a cashier told there are none rings one again from scratch.

## Hold offline: refused, not built

A held ticket is site-wide and claiming one is a **locked server step** so two
lanes cannot ring the same basket. Offline two devices could each hold and each
claim — a design question with money in it, not a missing feature.

So: press Hold with no line → refused **in words**, not a dead button (*a
disabled control on a touch screen tells nobody why*). The list says it cannot
be read. Help Centre corrected — it had promised *"you can still park a basket…
but only on this till"*, which was never true.

**Z-read provisional offline** — the plan always said it, the till never did.
The close screen now says it and names how many sales are still on the device.

## Still owed on this feature

Nothing, except the two runs that are not builds: the **2-week shadow run** and
the **72-hour soak**. Offline over plain HTTP still needs a domain + certbot
(service worker + `crypto.randomUUID` want a secure context) —
[[shopos-secure-context]].

Related: [[shopos-offline-shift-gap]], [[shopos-offline-in-a-browser]],
[[shopos-screen-testing]], [[shopos-tablet-chrome]], [[shopos-cover-cannot-ring]]
