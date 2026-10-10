# Every screen has a first heading

**2026-10-10 · the second of the items left after the queue**

Every console screen was given one `h1` when the console was walked A to Z.
The shop's screens were not. Forty-two of them titled themselves with

    <h2 className="text-xl font-semibold …">Customers</h2>

— the right words at the right size, one level down, with nothing above
them. "Jump to the first heading" is how somebody who cannot see a page
finds out which page it is, and on every shop screen it found nothing.

They are `h1` now, with the same classes: nothing moved on screen. The nine
Basic HR placeholders get theirs from `NotBuiltYet`. The till has no title
on it at all — every pixel is the sale — so its heading is read and not
drawn, inside a positioned ancestor (a hidden span with none once widened a
screen by 84px).

## What the browser found that the edit had not

`/tenant/products/new` came out with two. The item form is not a page: it is
a drawer over the product list, which stays mounted under it and keeps the
page's heading. So its title went back to `h2` and became what it should
have been — the DIALOG's name. It was `role="dialog" aria-modal` with no
name at all, announced as "dialog"; it is `aria-labelledby` its title now.

## Held in place twice

- `common/a11y/everyScreenHasAFirstHeading.test.ts` reads every page file:
  an `h1` of its own, or a part that is itself checked to have one
  (`PageHeader`, `DashboardHero`, `NotBuiltYet`, `StaffPage`, the sign-in
  forms), or a named reason. And no page may title itself in an `h2` with no
  `h1` in the file again.
- `e2e/chrome.spec.ts` counts first headings on each of the shop's 48
  screens, on a laptop and a phone: exactly one, with words in it. That is
  the check that caught the item form.

Panel only. No migration.
