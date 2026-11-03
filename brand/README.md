# Brand files for the phone apps

The True Serve mark, as drawn on 2026-11-01: both cuts at 45° and parallel, equal gaps, a straight
stem, the round foot centred under it. The geometry is the panel's
(`panel/public/images/logo/true-serve-mark.svg`); the colour here is the phones' teal.

| File | What it is |
|---|---|
| `mark.svg` / `mark.png` | the mark on a light ground (dark left bar) |
| `mark-ondark.svg` / `mark-ondark.png` | the mark on a dark ground (white left bar) — the splash uses this |
| `app-icon.png` | rounded square, mark and the name |
| `app-icon-markonly.png` | rounded square, mark only |
| `icon-foreground.png` | the Android adaptive-icon foreground (mark inside the safe zone) |

The SVGs are the source. When the mark changes, re-render the PNGs from them — and the launcher
icons in `mobile/` and `partner/` (`android/app/src/main/res/mipmap-*/ic_launcher*.png`, every
density, and `src/assets/brand/mark.png` = `mark-ondark.png`) — rather than redrawing anything.
The PNGs of 2026-11-02 were re-rendered into the same box and colours the earlier art used.
