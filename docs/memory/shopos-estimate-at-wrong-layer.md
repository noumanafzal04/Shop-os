---
name: shopos-estimate-at-wrong-layer
description: STANDING — a count taken at the wrong layer can be precise, auditable and still fund the wrong decision; "245 unnamed fields" was really 34, of which 24 were two buttons
metadata:
  type: feedback
---

The a11y backlog sat for four days as **"245 form fields have no accessible
name"** — a static grep of `<Input>` usages without an `id`. Asked in a real
browser across the 14 screens the layout suite already walks: **34 of 367 visible
controls**, and **24 of those were TWO buttons in the shared header**, counted
once per screen. Two `aria-label`s took it to 10; three more took it to 0.

**Why:** 245 reads as a migration; 34 reads as an afternoon. The estimate was the
only thing standing between them, and it looked responsible *because* it had a
number in it. A static count of CODE answered a question about code. Nobody was
ever going to ask "how many `<Input>` tags lack an `id`" — the question was "what
does a cashier using a screen reader hear", and only the thing that computes
accessible names can answer that.

**How to apply:** before quoting a backlog figure, ask what LAYER produced it and
whether that layer can see the thing being asked about. Prefer the measurement
taken where the user stands (browser, HTTP, device) over the one taken in the
source. And when a stale figure is corrected, leave the old one visible with the
correction beside it — the gap between the two is the lesson.

Related: [[shopos-detector-vs-rule]] (give every scanner a denominator),
[[shopos-screen-testing]] (only a browser sees layout), [[shopos-qa-sweep]].
