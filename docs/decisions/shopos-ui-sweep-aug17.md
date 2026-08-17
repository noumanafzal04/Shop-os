# The screens that looked blank

**2026-08-17.** A shop pointed at the bank screen and said the app looked
"white white" — and that edit/delete had been given no colour. Both true, and
neither was a bank-screen problem.

## What was actually there

Five identical grey `outline` buttons on one card — Add offer, Edit, Remove,
then Edit / Remove again per campaign — of which one deletes a bank.

> **Undifferentiated reads as blank, and it is worse than blank: nothing is
> emphasised, so nothing is warned about either.**

The cause was one level down. `Button` shipped with `primary` and `outline` and
**no way to say "this one destroys something"**, so every screen that needed a
Remove reached for the grey one. It was never going to be fixed screen by
screen while the vocabulary was missing.

## What the sweep found

Reading for it across all 64 tenant pages turned up five separate things:

| Finding | Count |
|---|---|
| The browser's own `confirm()` / `prompt()` box | **15 sites** |
| Row actions hand-written as bare coloured text | **27 sites, 20 files** |
| Tables wrapped in `overflow-hidden` — clipped, not scrollable | **8 pages** |
| Layouts splitting at `xl` with no `lg` step | **11 screens** |
| Panels capped against `vh` / `h-screen` | **23 places** |

### The native dialogs were the loudest

A `window.confirm()` cannot be styled, cannot say what the press actually does,
puts its buttons in the platform's order rather than ours, and on a tablet
lands mid-screen looking like a fault. Beside the product's own dialog it reads
as a different application.

And it has no `tone`. **The fifteen most dangerous moments in the app were
exactly the fifteen with no colour in them.**

`useConfirm` had existed the whole time. Two sites needed text as well as a
yes — a rejection reason, and renaming a till — so the shared dialog gained an
optional input, typed as an overload so `null` (dismissed) and `""` (confirmed,
left blank) can never be confused. A native prompt could not tell those apart
at all.

One test had to change with it: `TillDevicesPanel` drove `vi.spyOn(window,
"prompt")`, **which is exactly why the native box survived there**. A stubbed
global answers whatever you tell it to; it can never report that the question
looks like an operating-system error.

### Row actions were not only cosmetic

A line of text is a ~17px tap target, on screens held in a hand, with the row
underneath usually clickable and Delete sitting directly beside Edit. Missing
Delete and opening the record costs nothing. Missing Edit and hitting Delete
does.

Now `ROW_ACTION` / `ROW_ACTION_DANGER` — a ~36px padded pill with a hover
surface. Class constants rather than a component, deliberately: these live in
twenty different row layouts, and wrapping them all would have meant rewriting
twenty pieces of working markup to change how they look.

### Clipped is worse than either alternative

`overflow-hidden` was chosen for rounded corners, which is what it is good for.
It also cuts off anything wider than the box, unreachably. A twelve-column
purchase order in a narrow pane simply lost its right-hand end.

> Scrolling is fine. Squashed is ugly but honest. **Clipped looks finished and
> is wrong.**

### `xl` is not where a tablet lives

`xl` is 1280; a tablet in landscape is 1024–1194. Eleven screens handed every
iPad ever made the single-column phone stack. Nothing was broken, which is why
it survived — the page rendered, every figure was right, and it used half the
glass.

### The unit that hid the Save button was everywhere

`vh` is the LARGE viewport — the height the page would have if the address bar
were hidden. It is not hidden.

The Appearance canvas was `h-screen` and a flex column ending in Reset and
Save, so the merchant could change every colour in the shop and had no Save to
press. That one a shop reported. Reading for the same unit afterwards found
**twenty-three more**, including the two that matter most:

- **`ModalForm`**, capped at `85vh` — the component **every long form in the
  app is built on**, with the same three-band shape and Save in the footer.
- **The POS root**, `flex h-screen flex-col` — a column ending in the action
  bar. Reset, Hold, Drafts and Quote were laid out past the bottom of the
  glass.

Also Kitchen, the dine-in tab, and the Help Centre — every full-screen shell in
the product. One bug, one unit, twenty-three appearances, one of them reported.

## Two the shop photographed

- **The till's bottom bar had the top bar's bug**, in the same shape: both
  groups `shrink-0` inside `overflow-x-auto no-scrollbar`. At 768 the wordmark
  and the connection pill slid off the left edge with nothing saying they had.
  Hiding a scrollbar on a row of chips is fine — a half-cut chip is its own
  cue. On a row of buttons it is a control that silently is not there.
- **The Appearance gear sat on the cart's TOTAL.** `fixed right-0 top-1/2`
  lands on a page margin everywhere else; the POS is full-bleed and has none.
  It is no longer drawn on the till.

## Rules that came out of it

1. **A width that decides layout is stated once.** Anything that needs it reads it.
2. **A question to the merchant is asked by the product**, never by the browser.
3. **A view is a way of looking at the shop** — it gets no separate idea of what may be sold.
4. **Clipping is not fitting.**
5. **A panel measures the glass it is actually on** — `dvh`, never `vh`.

## Guards

All source-text rules — lint rules wearing tests' clothes, and all
mutation-checked (revert the fix, its own assertion fails, and only its own):

| File | Holds |
|---|---|
| `layout/tabletChrome.test.ts` | one breakpoint; the drawer owns its edges; `h-dvh` |
| `layout/tabletLayouts.test.ts` | an `xl` split says what it does at `lg` |
| `components/ui/confirm/native.test.ts` | no `window.confirm` / `prompt` / `alert` |
| `components/ui/button/destructive.test.ts` | Remove / Delete is coloured as one |
| `components/ui/table/clipped.test.ts` | no table inside a clipping wrapper |
| `components/ui/table/rowAction.test.ts` | row actions are pressable targets |
| `modules/pos/posChrome.test.ts` | neither till bar hides its own overflow |
| `components/ui/modal/viewportUnits.test.ts` | no panel capped against `vh` / `h-screen` |

Related: [shopos-tablet-chrome](shopos-tablet-chrome.md), [shopos-ui-conventions](shopos-ui-conventions.md), [shopos-pos-view-toggle](shopos-pos-view-toggle.md).
