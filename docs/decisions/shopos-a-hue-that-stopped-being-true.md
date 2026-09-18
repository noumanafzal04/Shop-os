# A hue that stopped being true

**2026-09-17.** The app's two palettes moved to #10B981 (shopping) and #EF4444
(working). Three defects surfaced, and none of them was visible — every one
came out of a measurement.

---

## 1. The comment that rotted

`lightColors.error` carried this, written when the brand was orange:

> *"A truer red than the brand's orange-red, so a refusal never reads as a
> button. At hue 4 against the brand's 20 they are told apart at a glance."*

It was correct. Sixteen degrees of hue is a real distinction.

Then the brand moved to #EF4444 — hue **0**. The sentence did not change, was
not edited by anybody, and became false. Brand and refusal now sat **4° apart
and 1.28:1 in luminance**: the same colour twice, with a paragraph above them
explaining why they were different.

A comment that states a RELATIONSHIP between two values is a test with no
runner. Either the relationship is asserted somewhere or the comment is a
claim about the past.

Fixed: the carmine palette's `error` moved to #9f1239 in light and #fecdd3 in
dark — the dark one told apart by lightness rather than hue, because on a dark
ground an error has to be pale and the brand already is. Staying in the red
family is deliberate: a pink or a fuchsia separates further and stops reading
as danger, which is the only job the colour has.

---

## 2. The guard that measured the wrong thing

The first version of the new assertion asked for a contrast RATIO between brand
and error.

Contrast ratio is luminance. It rates pink #f472b6 against red #f87171 at
**1.04:1** — "identical" — when nobody would confuse them. A guard built that
way would have **rejected the fix and accepted the bug**: it cannot see the one
axis the problem lives on.

It asks hue **or** lightness now — `apart(a,b) >= 12 || contrast(a,b) >= 1.8` —
and putting #d92d20 back makes it fail.

---

## 3. A colour that cannot carry its own label

#10B981 against white is **2.54:1**. That is not merely under AA for text
(4.5); it is under the **3:1 floor for a UI component**. A white button label
on it is a legibility defect, not a preference.

Against this app's ink it is 6.91:1 — so `onPrimary` is ink on the green
palette, and the reference screens the colour came from agree: the green there
was a pin and a dot, never a button, with the buttons in dark navy.

The related case: a brand-coloured mark on the pale green tint measures
**2.41:1**. This app had already shipped that exact mistake with a different
green — `CustomerHomeScreen` still carries the note *"primarySoft behind a
brand glyph measured 1.4:1 and read as disabled"*. So the emerald palette's
`primaryPressed` is step **700**, not 600, and is the shade a brand-coloured
mark takes. `primary` is for fills.

The carmine side has neither problem: #ef4444 on white is 3.76:1 — the same
stated cost the brand has carried since #e94e00 at 3.78 — and on its own tint
3.44:1.

---

## What changed

| | |
|---|---|
| `tokens.brand` | the Tailwind red ramp |
| `emeraldBrand` / `emeraldDarkBrand` | the Tailwind emerald ramp, replacing the leaf olive |
| `emberThemes` / `leafThemes` | renamed `carmineThemes` / `emeraldThemes` |
| `wearing()` | takes overrides, so a palette can correct what sits ON it |
| `values/colors.xml` + every launcher icon | regenerated at #10B981 |

The names were renamed because they describe a HUE, which is the bargain that
makes the mapping reversible — `ember` naming a red would have been the same
lie the `error` comment had just been caught telling.

`splashAndIntro.test.ts` asserts the Android hex against
`emeraldThemes.light.primary`, so the native frame and the JS palette cannot
drift apart again.

mobile 68 suites / 841 tests · tsc clean · eslint 0 errors.
