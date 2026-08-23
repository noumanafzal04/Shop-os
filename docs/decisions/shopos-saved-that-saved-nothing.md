# "Saved with warning", on a screen that had saved nothing

**2026-08-23 · panel**

## Reported

> on edit save — *Saved with warning · Add a description before saving an item
> that's shown online.* why?

## What was actually happening

`submit()` in the product form:

```ts
if (onlineRequired && !description.trim()) {
  setWarnings(["Add a description before saving an item that's shown online."]);
  return;                       // ← no request. Nothing saved.
}
```

…and the banner that renders `warnings` is titled, hard-coded,
**"Saved with warning"**.

Two states shared one banner: a warning the server returned *with* a save, and a
client-side refusal that saved nothing. So the message contradicted its own
title — *saved*, and in the same breath *add a description before saving* — and
the shopkeeper had every reason to believe the first half.

**They correct a price, read that it saved, close the drawer, and the edit is
gone.**

## The blast radius, measured rather than guessed

The demo shop it was reported on: **4 products, all 4 visible online, all 4 with
no description.** Not one price in that shop could be corrected, and every
attempt said it had worked.

## Two fixes, because there were two faults

**1 · A refusal never claims to have saved.** `blocked` is now its own state,
rendered as `variant="error"` titled **"Not saved"**, with the sentence ending
"Nothing has been saved yet."

**2 · On EDIT it is no longer a refusal.** The item is *already* online without a
description; refusing the save does not take it off the marketplace, it only
stops the shop fixing anything else about it. So edit saves and warns; create
still blocks, because there the red asterisk promises a refusal and nothing is
lost by asking first.

The asterisk follows the same line — shown only where the save really will be
refused. A field marked required that saves anyway teaches people to ignore the
mark.

## Note on where the rule comes from

The server **declares** it (`online_required`, from
`BusinessTypes::ONLINE_REQUIRED_FIELDS`) and does not **enforce** it on write.
The panel enforcing a server-declared rule is right; the panel inventing one
would not be. Worth keeping straight, because they look identical from inside
the form.

## Held by

`e2e/online-description.spec.ts`, in a real browser:

- an online item with no description can still have its price fixed — asserted
  against the SERVER, since before the fix the click produced no request at all;
- creating one refuses, and the word "Saved" appears nowhere.

Both state their precondition out loud: if the shop has no marketplace module
the rule never engages, and a test that would pass vacuously says so instead.
