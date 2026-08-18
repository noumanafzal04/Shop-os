---
name: shopos-ui-sweep-aug17
description: "2026-08-17 UI sweep: 15 native confirm boxes, 27 hand-rolled row actions, 8 clipped tables, 11 xl-only layouts. Button gained danger/ghost; confirm gained an input. 7 guard tests."
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-17T12:59:24.170Z
---

A shop said the screens looked **"white white"** and that edit/delete had no
colour. The cause was not the screen: `Button` had only `primary` and
`outline` — **no way to say "this one destroys something"** — so every screen
reached for the grey one. `docs/decisions/shopos-ui-sweep-aug17.md`.

**Undifferentiated reads as blank, and is worse than blank: nothing is
emphasised, so nothing is warned about either.**

Reading all 64 tenant pages found five classes:

| Finding | Count |
|---|---|
| native `window.confirm` / `prompt` | 15 sites |
| row actions as bare coloured text | 27 sites / 20 files |
| tables in `overflow-hidden` (clipped, not scrollable) | 8 pages |
| layouts splitting at `xl` with no `lg` | 11 screens |
| panels capped against `vh` / `h-screen` | 23 places |

**The native dialogs had no `tone` — so the 15 most dangerous moments in the
app were exactly the 15 with no colour in them.** `useConfirm` gained an
optional text input, overloaded so `null` (dismissed) and `""` (confirmed,
blank) cannot be confused.

**A test was part of why one survived:** `TillDevicesPanel` drove
`vi.spyOn(window, "prompt")`. A stubbed global answers whatever you tell it —
it can never report that the question looks like an OS error. Prefer driving
the real dialog.

Row actions were not cosmetic: ~17px tap target, Delete beside Edit, row itself
clickable. Now `ROW_ACTION` / `ROW_ACTION_DANGER` in
`components/ui/table/rowAction.ts` (class constants, not a component — 20
different row layouts).

**`vh` is the LARGE viewport, and the bug that hid Appearance's Save was
everywhere:** `ModalForm` at `85vh` (every long form in the app) and the POS
root at `h-screen` (its action bar laid out past the bottom edge), plus
Kitchen, dine-in tab, Help Centre. All → `dvh`.

**Rules:** a layout width is stated once · the product asks its own questions ·
clipping is not fitting · a panel measures the glass it is on (dvh, never vh) · `danger` is tinted, never filled (20 red slabs make
the one real warning meaningless).

Eight guard test files, all source-text, all mutation-checked. See the decision
doc for the list. Panel 865 green.

**Nothing here was rendered by me** — Chrome tools were disconnected all
session; the shop's screenshots caught the last two bugs.

Related: [[shopos-tablet-chrome]], [[shopos-ui-conventions]], [[shopos-pos-view-toggle]].
