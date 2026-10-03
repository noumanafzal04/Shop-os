---
name: shopos-hrm-is-a-module
description: Basic HR has a module key (`hrm`), off for every trade; registered before being built so the area is optional
metadata:
  type: project
---

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
