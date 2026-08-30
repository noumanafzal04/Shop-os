---
name: shopos-mutation-aimed-at-wrong-rule
description: STANDING — a mutation that does not fail may have been aimed at a rule that never measured it; openThingsFit checks HEIGHT, not width
metadata:
  type: feedback
---

Mutation-proving a new Playwright fit-test, I put a **3,000px-wide** child inside
the pay dialog and the test **passed**. First read: the test is vacuous.

Wrong. `everyRule`'s `openThingsFit` measures a dialog's **height** and vertical
position only, and the shared `<Modal>` clips horizontally — so a wide child is
invisible, not page-breaking. A **2,000px-tall** child failed it immediately with
"an open panel is taller than the screen".

**Why it matters:** a mutation that does not fail proves one of two very
different things — the test is blind, or *the mutation was aimed at a rule that
never measured that axis*. Read the rule before concluding the test is worthless.

**How to apply:** before declaring a test vacuous, open the rule and check which
dimension it actually asserts. `everyRule` runs exactly four rules —
`noSidewaysScroll`, `openThingsFit`, `nothingIsCovered`,
`pinnedThingsDoNotSitOnThePage`. `everythingHasAName`, `tapTargetsAreFingerSized`,
`scrollersCanReachTheirEnd` and `cardsAreSurfaces` are NOT in it and must be
called explicitly.

Related: [[shopos-detector-vs-rule]], [[shopos-measurement-that-lied]].
