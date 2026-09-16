# Tests

Empty until Phase 1. The conventions are the customer app's and are not
restated here — `mobile/__tests__/` is the reference.

Two that carry over as rules rather than as files:

- **A test must be able to fail.** Delete the step it covers and it goes
  red, or it proved nothing. Every guard in this product is mutation-run
  before it is trusted.
- **Never assert "not empty" on an envelope.** A response that arrived is
  not a response that was right.

And one this app needs from its first screen: the tab map in
`src/navigation/tabsFor.ts` is read by both the tab bar and the navigator,
so a screen offered by one and refused by the other is the bug class to
guard first.
