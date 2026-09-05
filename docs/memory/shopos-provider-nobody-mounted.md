---
name: shopos-provider-nobody-mounted
description: "2026-09-05 mobile: ThemeProvider was written, exported, documented as the only correct way to read a colour — and mounted NOWHERE, so dark mode could not work and useColors() threw; the deprecated fallback was the only thing that functioned"
metadata:
  type: project
---

**The mobile app's `ThemeProvider` had never been mounted.** It existed, was
exported from `theme/index.ts`, and its own docblock called `useColors()` "the
only way a component should learn a colour". Calling it threw:

```
useTheme must be used inside <ThemeProvider>
```

So dark mode had not been *switched off* — it **could not run**. Every screen
had settled for the `colors` export that `theme/index.ts` marks
`@deprecated`, which is the LIGHT palette frozen, and the app looked correct
because light is what everyone develops in.

**Why it stayed invisible for so long:** the deprecated fallback worked
perfectly. A broken feature with a working fallback produces no bug report —
23 files reached for it not as a shortcut but because it was the only thing
that functioned, which makes the debt look like a style preference.

**How it surfaced:** by writing the FIRST screen to follow the documented
advice. `BusinessAccountScreen` called `useColors()` and would have crashed the
moment a shop's account signed in. The rule generalises: *the first honest
consumer of an abstraction is what tests whether the abstraction is connected.*

Same family as [[shopos-switch-with-nothing-behind-it]] and
[[shopos-promise-in-another-file]] — a thing that reads as done.

## What now guards it

- `__tests__/theme.test.tsx` mounts the real `<App />` and asserts **exactly
  one** `ThemeProvider` (two means the inner one silently wins).
- It also asserts `bg`/`surface`/`text`/`border`/`primary` **differ between
  themes** — a token that survived a dark pass unchanged is a token the pass
  MISSED, and it will be near-black on near-black.
- `__tests__/darkModeDebt.test.ts` began as a **ratchet**: the 23 light-frozen
  files listed, the list allowed only to shrink, and a migrated file left on
  the list failing too (or the list becomes somewhere a new offender hides
  behind an old name).

All mutation-proven.

## The debt is CLEARED (same day)

All 23 migrated, and the migration was mechanical rather than a rewrite:
`StyleSheet.create({...})` became `makeStyles(c) => StyleSheet.create({...})`,
`colors.` became `c.`, and each component gained
`const c = useColors()` + `const styles = useMemo(() => makeStyles(c), [c])`.
**Layout stayed in the stylesheet; only colour moved.** Script kept at
`/tmp/themeify.py` shape — worth rewriting if this ever recurs.

**Two things done because the ratchet made them visible:**

1. **The app was PINNED to light** (`initialPreference="light"`) for as long as
   any screen could not leave it, and the debt test asserted `pinned === (debt >
   0)` — so a half-dark app could not ship AND the pin could not be forgotten.
   Released when the count hit zero.
2. **The static `colors` export is DELETED**, not merely unused. An export like
   that is not neutral dead code: a screen that imports it compiles, renders,
   looks right to whoever wrote it, and is frozen in light mode on somebody
   else's phone. Deleting it moved the rule from a test that greps to the
   compiler.

Two traps the mechanical rename set, both caught by lint rather than tsc:
a default parameter cannot read a hook (`backgroundColor = c.white` in
SafeScreen — and the default should have been `c.bg` anyway), and
`categories.map((c) => ...)` shadows the palette in two screens.

## The palette rule worth keeping

Repaletting to the new brand (#D62400) changed **zero call sites**: the token
NAMES stayed and only the hexes moved. `brand[500]` is read ~500 times, and in
dark it resolves to #F35D3B rather than #D62400 — **an index names the JOB, not
a pigment.** Below 500 the dark steps get darker (a faint brand ground on a dark
page is dark); above it they get brighter, because "louder than full strength"
has nowhere else to go.

Related: [[shopos-mobile-is-customer-and-rider]], [[shopos-detector-vs-rule]].
