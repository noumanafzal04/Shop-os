---
name: shopos-qa-walkthrough
description: "SHIPPED 2026-09-03: in-app QA walkthrough at /tenant/qa and /admin/qa — 11 sections, next/previous, separate from the Help Centre on purpose"
metadata:
  type: project
---

A QA test flow so somebody new can learn **what the product is, what each part
is for, where it lives, whether a shop needs it, and how to test it**.

**NOT the Help Centre, deliberately.** The Help Centre is written for a
shopkeeper and is FILTERED to what their shop has — which is exactly wrong for a
tester, because the parts a shop switched off are the parts somebody has to
check are properly off. So this is unfiltered and names the module each thing
needs. See [[shopos-help-centre]].

**Where:** `/admin/qa` (linked on the admin rail) and `/tenant/qa` (in no menu —
a tester is usually signed in as the shop they are testing).

**Shape:** 11 sections · 21 steps · Next/Previous + arrow keys + progress + a
section rail. Every step: *what it is and why* FIRST, then where/module/trade/
required, then numbered `do → expect`, then separately **"what a real failure
looks like here"** so a rule is never filed as a bug.

**It opens on the three axes** (MODULE / TRADE / PERMISSION) — "most first-week
bug reports are one of them doing its job" — plus server-side pricing and the
never-rewrite-a-closed-day rule.

**How to apply:** when a screen or module is added, the walkthrough is one more
place that must be updated — `src/modules/qa/content.ts`. Its own guard
(`content.test.ts`, 9 tests) catches a dead screen path, a fake module name, a
step with nothing to do, a check with no expectation, and **a module count in
prose that no longer matches the registry** (mutation-proven).

Six existing guards had to be satisfied for the new screen — route list,
full-screen pinned room, menu reach, permissions map, help-article map, browser
walk. See [[shopos-guards-share-a-blind-spot]].
