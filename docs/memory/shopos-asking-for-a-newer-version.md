---
name: shopos-asking-for-a-newer-version
description: Header refresh control — 5 distinct answers, never "up to date" when nobody looked; SW registration lives in AppLayout, not the strip
metadata:
  type: project
---

2026-08-26. **When does the update offer appear?** The SW is `prompt` (never
`autoUpdate`). A browser looks for a new worker on navigation, and a till is
never navigated — so `updateWatch` polls **once an hour** while online. Up to an
hour's delay, and no way to ask.

**Shipped:** a refresh control in the header (both consoles), and
`checkForUpdate` returning **five distinct answers**: found / installing /
current / offline / unavailable. The rule that must not be softened: *"nothing
found" and "I could not look" are different sentences*. Never report `current`
when `isOnline()` is false or when there is no registration (plain http). A
mutation test pins the offline branch.

**"Later" no longer clears the waiting flag** — it used to, so dismissing the
strip made the app forget the update existed. Dismissal is local; the header is
where you go back to it.

**Registration moved out of `UpdatePrompt` into `ServiceWorkerHost`, mounted in
`AppLayout`.** `useRegisterSW` may be called exactly once. The strip is
shop-side only, so the admin console had no registration and the button lied
there. NOT the app root — that includes the landing page, and registering there
precaches megabytes for a stranger. See [[shopos-offline-plan]].

Profile dropdown icons were filled glyphs in a line-icon product; redrawn, and
the sign-out arrow pointed the wrong way (into the box = sign in).
