# Built, tested, and reachable by nobody

**2026-08-17.** The oldest shape in this codebase, turned into a rule that runs
on every commit.

## Eleven times by hand

> *"A capability is not shipped until something a person touches can reach it."*

Written down here eleven times, each after somebody found an instance by hand:
the reorder list nobody could open · the offline-selling switch with no admin
screen · and the largest, the entire offline module — barcode index, search,
category index, stock-delta derivation — every piece built and tested, and the
POS wired to none of it, so offline **a till could not put a single item in the
cart, in any trade**.

Every one of them was findable mechanically. The check is one sentence:

> **An export whose own test file is the only thing that uses it.**

Tests prove a thing works. They do not prove anybody can get to it.

## Two exemption lists, deliberately separate

**`TEST_ONLY`** — `reset…`, `forget…`, `clear…`, and map introspection. Their
whole job is to put a module back to a known state, or to let a test check a
map from both directions. They will never have an app caller and should not.

**`NOT_SURFACED_YET`** — unshipped capability, each line naming **what has to be
built** for it to leave the list. Four today:

| | Leaves when |
|---|---|
| `pillLabel`, `isPulling` | a sync-progress indicator exists |
| `isOfflineNumber` | a sale row needs an offline badge |
| `code128Svg` | something sizes a barcode by the symbol, not the label |

The second list is the one to watch. **The moment it grows past a handful it is
telling you the product is accumulating work nobody can use.** Naming the
trigger is what stops "still exempt" from quietly meaning "still forgotten".

`code128Svg` is the instructive one: it looked like dead code, and deleting it
would have thrown away a deliberate decision. Its own file explains that
`LabelsPage` uses the bars-only variant because the fixed-width one *"happily
renders 280px of bars into a 50mm sticker"*, **and** that its XSS escaping was
written precisely because it has no caller — *"exactly the argument for escaping
it now rather than the day it gets one."*

> Read the file before deleting the thing the file already explains.

## Three bugs the rule itself had

Worth recording, because an audit is code too.

1. **`RegExp.test` with `/g` is stateful.** Alternate calls returned false, so
   real callers looked absent and it accused `flushVariances` of being
   unreachable while `pullNow` called it directly. Fixed by counting matches
   with a fresh regex.
2. **Comments counted as callers.** A file that *mentioned* a helper in a
   comment looked like a file that called it, so removing the last real call
   left the check green. **A rule a leftover sentence can satisfy is not a
   rule.** Comments are stripped now; imports are still counted, because eslint
   already fails the build on an unused one.
3. **It timed out.** Stripping comments inside the counter meant doing it for
   every export against every file. Doing the expensive part once is the
   difference between a rule that runs on every commit and one somebody
   switches off.

> **An audit tool that produces findings is a thing to verify, not to believe.**

## The author's own instance

This session shipped `useRecurringIncomes` / `useRecurringIncomeMutations` — a
backend, a service, hooks, tests, and no screen. Found by running this very
check, reported rather than quietly fixed, and the Income page now has the tab.

Mutation-checked: removing the only real caller of `withLocalStock` — call and
import, the way it would actually happen — fails the rule and only the rule.

Related: [shopos-offline-browse](shopos-offline-browse.md), [shopos-sold-out-and-reachability](shopos-sold-out-and-reachability.md), [shopos-reorder-and-labels](shopos-reorder-and-labels.md).
