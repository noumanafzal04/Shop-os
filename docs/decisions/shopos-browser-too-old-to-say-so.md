# A browser too old to say so

**2026-09-04.** Shop's words: *"ios pe issue aa rahi, dashboard branding bhi
show nahi ho rahi tab pe / aur POS mein background issue kar raha, left side
product side ka."*

---

## Why nothing about those screens is wrong

Tailwind v4 compiles **every** opacity modifier — `bg-white/5`,
`bg-brand-500/15`, `border-white/10` — to `color-mix()`. The built stylesheet
carries **304** of them, plus **41** `oklch()` colours.

Safari learned `color-mix()` in **16.2**. Tailwind v4 states **16.4** as its
floor, in its own documentation.

Below that line those declarations are not *wrong*, they are **invalid** — and
an invalid declaration is dropped in silence. No error, no console warning. The
element simply keeps whatever it had, which for a tinted surface is nothing.

So the sidebar tint goes, the till's product pane loses its ground, the brand
accents stop showing, and the shop sees software that looks broken. Both
complaints are the same single cause, and neither is a defect in the screen
being complained about.

## Why there is no fix, only an answer

There is no honest polyfill here. These colours are computed by the browser at
paint time out of custom properties this app **rewrites at runtime** — that is
how per-tenant branding works (`src/common/theme/tenantTheme.ts`). "Just emit a
fallback" means re-deriving the entire palette in JavaScript, in both themes,
for a browser we have deliberately chosen not to support.

Downgrading to Tailwind v3 to buy Safari 15 is not a patch either; it is a
rebuild of the design system.

So the decision is: **support Safari 16.4+, and say so out loud on anything
older** — once, dismissibly, where the shop can act on it.

`src/components/system/OldBrowserNotice.tsx`, mounted above the router so it
reaches every screen including the full-screen till. Every style in it is
inline and every colour a literal: a component whose subject is "this browser
cannot compute our colours" must not ask the browser to compute its own.

## It is also the diagnosis

This started as a question I could not answer from here — *is this iPad below
16.4, or is this a real bug?* — and iOS Safari cannot be run on this machine.
Playwright's WebKit is a recent build, so it cannot reproduce an old one.

Now the device answers it. Open the app:

* **the banner is there** → the browser is too old; the fix is iPadOS 16.4+.
* **the banner is not there** → the browser is fine and the missing
  backgrounds are ours to find.

Turning a blocking question into one the user answers by looking is worth more
than the banner itself.

## The guard

`src/components/system/oldBrowser.test.tsx`. `CSS.supports` is stubbed rather
than trusted — jsdom has no CSS engine, and the question is what the component
does WITH the answer, not what jsdom's answer happens to be.

Both directions are asserted, because they are opposite failures: a capable
browser seeing this banner would be a permanent scare on every screen in the
shop; an incapable one not seeing it is the silence this exists to end. It also
asserts the copy names **16.4** and says nothing is at risk — "unsupported
browser" tells a shopkeeper nothing they can act on.
