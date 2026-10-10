# The first paint asks nothing of the internet

**2026-10-10 · found by a spec that failed for no reason of its own**

Two full runs of the admin specs failed in three different places — a heading
that never appeared, two screens that "took 7.3 seconds to arrive" — and each
passed alone. The API was answering in under a tenth of a second and nothing
was refused.

The trace of one failure had it:

```
5341 ms  https://fonts.googleapis.com/css2?family=Outfit…
3425 ms  https://fonts.gstatic.com/s/outfit/v15/…woff2
```

`src/index.css` began with `@import url("https://fonts.googleapis.com/…")`.
An `@import` is part of the stylesheet it sits in, and a stylesheet blocks the
first paint. So **every screen of the panel waited on Google before it drew
anything.**

On a good line nobody notices. On a slow one the app sits blank for as long as
the font server takes. And on a router that is up with the line behind it down
— which is what load-shedding looks like from inside a shop — the request
neither succeeds nor fails, and a till that was reloaded stays white until it
times out. That is the one moment the offline till exists for, and the service
worker could not help: the font was never one of its files.

## What changed

- The two Outfit files Google serves (latin, latin-ext; variable 100–900, v15)
  are in `panel/src/assets/fonts/`, declared by `@font-face` in `index.css`
  with the same unicode ranges and `font-display: swap`.
- Vite fingerprints them; the service worker precaches them with the rest
  (`woff2` was already in its glob). Nothing in the build names Google.
- SIL Open Font License 1.1 — `assets/fonts/OFL.txt` travels with the files.
- `src/test/firstPaintAsksNobody.test.ts` holds it: the stylesheet imports
  nothing from another server, no rule points at one, `index.html` links no
  outside stylesheet or font, and both subsets are declared from local files.

## Two things worth keeping

**A failure that passes alone is not a one-off.** This is the second time in
one day (the first was the API's request limit). Both times the evidence was
in the run that failed — the page's own words, then the trace's network list —
and both times re-running first would have thrown it away. Read the failed
run's trace BEFORE running anything again; Playwright deletes it on a pass.

**A stylesheet imported into a vitest test arrives empty**, `?raw` or not. The
first version of the guard passed three assertions about a string of length
zero. It reads the file from disk now, and its first test is that it did.
