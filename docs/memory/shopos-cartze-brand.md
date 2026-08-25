---
name: shopos-cartze-brand
description: the product is CartZe (cartze.shop) — renamed 2026-08-23; wordmark is a COMPONENT not an .svg, because an SVG in an img tag inherits no font and knows no theme
metadata:
  type: project
---

**The product's name is CartZe.** Domain `cartze.shop`, bought by the user
2026-08-23. The panel was renamed that day: 105 strings, the PWA manifest, the
app icons (regenerated from `public/images/logo/app-icon*.svg`), and a `<title>`
— of which there had been **none at all**, so the browser tab read "localhost".

`ShopOS` may still appear in the BACKEND, in `docs/`, and in this memory
directory's older files. Those were left deliberately; only the panel's
user-visible surfaces were renamed. Ask before sweeping the rest.

**The wordmark is `src/components/brand/Brand.tsx`, not an image**, and the
reason generalises to any logo in this app: **an SVG loaded through `<img>` is
its own document.** It does not inherit the page's font, cannot fetch Outfit from
Google Fonts, and knows nothing about dark mode — which is exactly why there were
two files (light and dark) forever one edit apart. Rendered inline it is text in
the page: the app's typeface, the theme through a token, one file to change.

`Wordmark` takes `tone="onDark"` for surfaces that are dark in BOTH themes (the
sign-in panel sits on `brand-950`), where theme-following colours would put
near-black letters on near-black blue.

The maskable app icon is a SEPARATE drawing, not the badge relabelled — Android
crops it to the launcher's shape. Rendered with `qlmanage -t -s 512` and resized
with `sips`; no other rasteriser is installed on this machine.


## The rename is DONE — and three names must never join it (2026-08-25)

Every user-visible "ShopOS" is now CartZe. The ones that mattered were the ones
that leave the building: the **SMS sender name** (what shows on a phone before
the message is opened), the verification code's text, the email subject.
`OtpDeliveryTest` caught the change, which is the right way round.

**NEVER RENAME these three** — they name data already on shopkeepers' devices,
and a rename hides it rather than migrating it:

| key | cost of renaming |
| --- | --- |
| `shopos-till` | IndexedDB name. Till points at an EMPTY database — **the outbox is in there**. Every unsent offline sale orphaned: money taken, server never hears. |
| `shopos-device-id` | new id → new slip segment → counter restarts at 000001 → duplicate slip numbers, customer unfindable. See [[shopos-offline-slip-numbers]]. |
| `shopos-auth` | every shop signed out at once, mid-day. |

Guarded by `src/modules/offline/storageKeys.test.ts`, mutation-proven — a
comment was not enough ([[shopos-promise-in-another-file]]). If they ever must
change, it is a MIGRATION that reads the old name and writes the new, never a
find-and-replace.
