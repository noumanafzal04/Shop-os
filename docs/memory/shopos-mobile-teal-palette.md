---
name: shopos-mobile-teal-palette
description: FOR LATER (after the panel ships) — the True Serve teal palette for the MOBILE app; palette B wins, measured against the logo
metadata:
  type: project
---

2026-10-02. The user supplied two teal/orange palettes and the **True Serve
app icon** (deep-teal rounded square, bright-teal "T", white wordmark) and
asked which fits. **Not to be applied yet** — their words: "we will use this
later on after complete full panel side for launch, this is just for keeping
in memory."

**Verdict: palette B.** The teals are a tie; the DEEP shade decides it.

| | palette A | palette B | logo |
|---|---|---|---|
| burnt | `#C4421A` | `#E66414` | — |
| orange | `#F98F45` | `#FF924D` | — |
| mist | `#97CECC` | `#9AD3DA` | — |
| teal | `#12908E` | `#00A8A8` | mark ≈ `#2CB5AE` (176.9°) |
| deep | `#16594A` | **`#03444A`** | bg ≈ `#0D4A4E` (183.7°) |

- **deep vs the icon's background: B is 1.4° apart, A is 17.1°.** A's
  `#16594A` sits at 166.6° — that is GREEN beside a teal icon, and the eye
  reads it as a different brand. Hue distance is the instrument for "do these
  belong together"; a contrast ratio cannot answer it (see
  [[shopos-a-page-with-no-shape]]).
- teal vs the mark: A 2.1°, B 3.1°. Not the discriminator.
- orange vs teal: ~157–165° apart in both — a true complementary pair, so the
  accent will read as deliberate.

**CONTRAST, which decides what each one may be used FOR** (white / `#111`):

| colour | on white | on ink | may be |
|---|---|---|---|
| `#03444A` | **10.88:1** | 1.74 | the PRIMARY — buttons, headers, anything carrying white text |
| `#00A8A8` | **2.93:1** ✗ | 6.44 | decoration only — fills, chips, the mark, charts. **Never white text**; ink if it must carry a label |
| `#9AD3DA` | 1.65 | 11.42 | surfaces and tints only |
| `#E66414` | 3.39 ✗ | 5.57 | fails white text; use A's `#C4421A` (**5.07:1**) where the orange must carry white |
| `#FF924D` | 2.22 | 8.52 | tint, ink-on only |

⚠️ `#00A8A8` at 100% saturation beside `#FF924D` at 100% will vibrate. Keep one
of the pair quiet.

This repeats the lesson already recorded in [[shopos-mobile-customer-shape]]:
the saturated brand mid-tone is NOT the text-safe shade — white on `#10B981`
measured 2.54:1 and `primaryPressed` had to drop to 700. Here the text-safe
shade is the deep one, `#03444A`.

Current mobile palette is emerald `#10B981` / carmine `#EF4444`
(`emeraldThemes`). Switching to teal means the NEUTRALS move too — the greys
carry a trace of the brand's hue, and a grey built for emerald (136° away)
would be as wrong as the warm grey was when the brand left orange.

Related: [[shopos-mobile-customer-shape]], [[shopos-mobile-design]], [[shopos-cartze-brand]]
