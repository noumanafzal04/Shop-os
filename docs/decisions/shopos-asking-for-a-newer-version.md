# Asking for a newer version

**2026-08-26 · panel**

## When did the update button appear? Up to an hour after the deploy

The service worker is registered with `prompt`, never `autoUpdate`, and that is
deliberate: an automatic swap replaces the running app between one sale and the
next, and once the outbox exists it can change the local schema while unsent
sales are queued. The moment of the reload has to be one somebody chose.

A browser notices a new worker on navigation, and **a till is the one screen
nobody navigates** — it is opened on Monday and used until Saturday. So
`updateWatch` polls once an hour while online. That is the right cadence for
something nobody should have to think about, and useless the moment somebody
**is** thinking about it: told "the new prices are live", a shop could only
wait, or reload and hope.

## And "Later" was a one-way door

Dismissing the strip called `setNeedRefresh(false)` — the flag that *means* a
new version is waiting. So refusing an update mid-shift made the app forget the
update existed, and nothing on any screen offered it again until an unrelated
reload. That was survivable while the strip was the only surface.

It is not the only surface any more, so the dismissal is local now and the flag
is left alone. A test pins it.

## What was built

A refresh control in the header, beside the bell, on both consoles.

It answers with **one of five things**, and separating them is the whole point:

| | |
|---|---|
| `found` | A build is downloaded and waiting. |
| `installing` | One is on its way down; you will be offered it shortly. |
| `current` | Asked, answered, nothing newer. |
| `offline` | No line, so nobody asked. |
| `unavailable` | No service worker at all — this copy cannot update in place. |

**"Nothing found" and "I could not look" are not the same sentence**, and a
shopkeeper acts differently on each. A till offline for the afternoon must not
be told it has the newest prices; nobody looked. A copy served over plain http —
where a browser refuses to register a worker — must not be reassured it is
current either.

Offline is deliberately **not** an error and not red: a till with no line is
doing exactly what it was built for, and alarming a cashier mid-sale about
something that is not wrong is its own defect.

While a build is waiting the control stops being "go and look" and becomes the
way in — named, coloured, and impossible to lose behind a dismissed strip.

## The bug the button exposed on its first press

It answered **"this copy cannot update itself"** on the admin console, every
time, about an app that updates itself perfectly well.

`useRegisterSW` may be called exactly once, so it lived inside `UpdatePrompt` —
and `UpdatePrompt` is mounted shop-side only. There was no registration on the
admin console to ask. Fine while the strip was the only thing that cared; a lie
the moment anything else did.

Registration moved to `ServiceWorkerHost`, mounted in `AppLayout`: **both
consoles, and nowhere else.** Not the app root, because the root includes the
landing page, and registering there would precache megabytes of console for a
stranger who came to read a page about a till, on their own mobile data.

Verified in a real browser afterwards, on `/admin` of a real build: worker
registered, "You are on the latest version" online, "No connection…" with the
network cut. Three distinct answers, not one.

## The dropdown's icons

Four solid filled glyphs — `fill-gray-500`, `fillRule` paths, one pasted in at
four decimal places — in a product whose every other icon is a 24-grid line
drawing at stroke 1.6. The one panel a shopkeeper opens to find their own name
was the one place the drawing style changed.

Redrawn as one family. The sign-out arrow now points **out**; it pointed left,
into the box, which is the icon for signing in.
