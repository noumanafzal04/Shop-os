# A cart line is itself, and only itself

**2026-10-06 · reported from the counter**

> "jb add to cart rows ati, kisi aik ko discount dy raha — wo aik or row py b
> apply ho raha."

## Why

Every cart line has a key, and everything done to a line — discount,
quantity, remove, price level, serial numbers — finds it by that key. The key
was a counter in the page's memory: c1, c2, c3.

The cart is also parked on the device so a refresh mid-sale costs a blink
rather than the trolley. It was parked, and restored, **with its keys** — and
the counter came back at nought. The next item rung was c1 again.

In a browser, before the fix:

| Done to the new line | What happened |
|---|---|
| Pressed it | the OLD line's sheet opened |
| + | both quantities moved |
| Remove | both left the bill — Rs 11,897 became 6,941 |

The last is the dangerous one: goods in the bag and off the bill.

## The rule

A key is only ever issued by `lineKeys.ts`, and is never trusted from
anywhere a previous page could have written it. Anything that brings lines in
from outside this page — the parked cart, a held ticket — is re-keyed on the
way in. That also heals a cart parked while it was already broken.

## Tests

`e2e/till-lines.spec.ts`: two items, a reload, a third — then discount,
quantity and remove, each on one line. Red before, green after, on desktop,
phone and tablet. `lineKeys.test.ts` reloads the module to reproduce the
restart.
