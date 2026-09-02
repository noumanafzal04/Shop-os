---
name: shopos-saves-that-say-nothing
description: FIXED — 25 panel saves failed with nothing on screen; the count was wrong FIVE times first (194/81/68/46/30/25) because each detector could not see one of the remedies
metadata:
  type: project
---

Twenty-five `.mutate()` call sites handled failure **nowhere** — not on the
call, not on the declaration, not by rendering `.error`, not in a `try`. Each
passes an `onSuccess` that toasts and nothing for the other outcome, so **a
failed save looks exactly like one that worked**: the toast simply never
appears.

`TaxGroupsManager` was the sharpest — "Tax group saved" and no error path in the
file, so a shop changing its **GST rate** could be told nothing and sell at the
old one all week.

## The count was wrong five times first

| count | what it actually measured |
|---|---|
| 194 | `useMutation` declarations with no `onError` — counts **hooks** |
| 81 | call sites with no inline handler — misses the declaration's own |
| 68 | misses `{ ...failed(…) }` and options built into a variable — **the guard could not see the fix it asks for** |
| 46 | misses an alias: `const mutation = isEdit ? update : create` |
| 30 | misses `mutateAsync` inside a wrapper that try/catches |
| **25** | honest |

The alias miss put the **product form** on the list — the most-used write in the
panel, which renders field errors beside the very inputs. The `mutateAsync` miss
gave the **forecourt** five entries for handling failure *better* than most of
the app. **A detector that cannot see the remedy keeps reporting the disease.**

## Why NOT a global MutationCache handler

React Query runs three error callbacks in order — the cache's, the mutation's,
then the one passed to `mutate()`. **The cache's runs FIRST**, and the per-call
one lives in a private (`#`) field on the observer. So a global handler cannot
tell whether anything after it will report, and **102 call sites already do** —
it would double-toast every one.

## How to apply

- `src/common/api/failed.ts` — server field error → server message → your words.
- The till is exempt: `PosPage` uses a standing red strip, never a toast, and
  says why — *"a cashier looks up from the cash, not at a strip that has already
  faded."* Match the screen's own voice.
- `e2e/savesSayWhenTheyFail.guard.ts` is a **gate at zero**. Its first version
  **could not fail at all**: a 900-char window read past the end of the options
  object into the next handler in the file. Brace-match, and mutation-test every
  gate before believing it.

Related: [[shopos-detector-vs-rule]], [[shopos-estimate-at-wrong-layer]],
[[shopos-mirror-and-refusal]], [[shopos-saved-nothing]].
