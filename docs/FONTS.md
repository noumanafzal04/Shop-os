# Fonts

The app currently draws in the **system typeface** — San Francisco on iOS,
Roboto on Android. That is a deliberate hold, not an oversight: a React Native
app cannot fetch a webfont, the files have to be bundled, and bundling a
typeface is a licensing decision rather than a code one.

## What to send

Two families, `.ttf`:

| Role | Used for | Weights needed |
| --- | --- | --- |
| **Display** | The wordmark, screen titles, prices | 700 |
| **Body** | Everything else | 400, 600, 700 |

The reference design used **Aclonica** for display (SIL Open Font License —
free to bundle and ship). Any body face pairs with it; a neutral grotesque
reads best under a display face that decorative.

## Where they go

```
android/app/src/main/assets/fonts/*.ttf
ios/            → added to the Xcode target + listed in Info.plist
                  under UIAppFonts
```

Then `react-native-asset` links them, and `src/theme/tokens.ts` gains a
`fontFamily` on each entry of the `typography` scale. Every screen already reads
that scale, so nothing else changes.

## The Android trap

On Android, `fontFamily` and `fontWeight` set together do **not** compose: the
platform picks the file whose name matches, and ignores the weight. So the files
must be named per weight — `Inter-Regular.ttf`, `Inter-SemiBold.ttf`,
`Inter-Bold.ttf` — and the scale must name the FILE, not a family plus a weight.

This is why `fontFamily` has not been added speculatively. Wiring it before the
files exist would silently break the weights that currently work.
