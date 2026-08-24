# Thirty-two screens no browser had ever opened

**2026-08-24 · panel**

## The denominator

`chrome.spec.ts` walks the shop's screens and asks the questions only a layout
engine can answer. It held **fourteen**. The shop has **forty-eight**.

```
16 walked · 48 shop-side screens · 32 NEVER opened in a browser
```

Not a lower standard on those thirty-two. **None.** Every rule the suite
enforces — nothing covered, nothing off the edge, every control reachable by a
finger, every control callable by name — had run zero times against two thirds
of the product.

That gap is not theoretical. It is how the kitchen board spent six days showing
dockets for tabs that had been cancelled: the screens nobody looks at are the
ones nothing is measured against.

## What the first walk found

Twenty more screens went in — every one the MART fixture can reach. Two
failures, and they are different in kind.

### A modal is supposed to cover the page

`/tenant/products/new` reported the entire sidebar, the wordmark and every menu
item as unpressable, behind `div.absolute.inset-0.bg-gray-900/30`.

All correct. The product form **is** a dialog — `role="dialog"`,
`aria-modal="true"`, a drawer over the catalogue — and a backdrop that covers
the page is a backdrop doing its job. The rule had simply never met one, because
no route it walked opened in a modal.

So the rule learned the concept: while a modal is open, only the controls
**inside** it are judged. The half that matters is preserved — a cover *within*
the panel is still a finding, and proved so by planting one over the dialog's
own Close button, which is one of the original defects this suite was written
for.

### Eight controls that announce themselves as "edit text, blank"

| screen | what |
|---|---|
| activity | both filters and both date boxes |
| online orders | the status filter |
| quotes & invoices | the status filter |
| **a new sale** | **Discount and Amount paid** |

The last row is the one that matters. Two money boxes side by side, each
labelled by a `<span>` rather than a `<label>` — visible, and silent. A
discount typed into amount paid is a bill that balances and is wrong.

Same shape as `shopos-label-not-attached`: labelled and unattached. That pass
fixed what it could see; these screens were not in anything's field of view.

The activity ones had been under my hands the same day, adding a `record`
filter, and I did not notice.

## Where it stands

```
0 of 758 visible controls across 34 screens have no accessible name
```

Up from 0 of 346 across 14.

## What is still uncovered

The trade-gated screens: the forecourt, the dispensary, the workshop, the bay
board, vehicles, warranty, riders, portfolio, reservations. Each needs a shop
that has that trade — the same problem the `restaurant` project was created to
solve, and the same fix: a fixture shop per trade.

`/tenant/setup` is deliberately excluded: opening it would re-run a shop's
setup, and a walk must not change what it walks.
