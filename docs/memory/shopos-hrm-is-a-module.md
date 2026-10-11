---
name: shopos-hrm-is-a-module
description: Basic HR (`hrm`) is NOT in this version — user decision 2026-10-10; 9 placeholder screens stay off for every trade; do not build it or count it as remaining work
metadata:
  type: project
---

**USER DECISION 2026-10-10 (their words): "HR ko chor do abhi ni kryn is versioin main ni kryn gy".** Basic HR is out of this version. Do not build it, do not propose it, and do not count it in "what is left" or in a completion percentage for the panel.

**How to apply:** leave the nine placeholders and the `hrm` key exactly as they are (off by default; every trade CAN be handed it by the admin, whose module list says "still being built"). Hiding it from the admin's module list for this version was my suggestion only — not asked for, not done.

**2026-10-04.** `hrm` is in `Modules::all()`, group **People**, `depends: []`.

Nine Basic HR screens say "not built yet" and save nothing. They had no key,
so `RequireFeature` had nothing to gate on and **every** shop carried an HR
department in its sidebar. The code said so and called it temporary; it
stayed temporary for months, which is how a placeholder becomes furniture. A
nav guard had even written the debt down: *"PLACEHOLDER — owes a module key
before it does anything."*

**Registered before it is built, on purpose.** The key is what makes the area
optional — hand it to the few businesses reviewing the shape, and every other
shop stops seeing a department it does not have. **No trade gets it by
default**: an unbuilt module must never arrive on its own.

`depends` is empty because payroll is about people, not products — a
books-only office with no catalogue is the shape most likely to want it first.

Gated in four places and they must stay in step: `Modules::all()`,
`BusinessTypes::FEATURES`, the panel routes + sidebar, and the nine Help
articles. Three guards catch drift automatically, including a module COUNT
written into the QA walkthrough's prose.

Related: [[shopos-modules-on-off]], [[shopos-check-that-cannot-fail]].
