---
name: shopos-app-on-a-real-emulator
description: "2026-09-05 the customer app ran on an Android emulator for the first time — and every bug worth finding was one a green test suite could not see: three kinds of silence, an invented promise, one rule copied five times, and Metro serving a syntax error it had already been told about"
metadata:
  type: project
---

**First run of the CartZe customer app on a device.** tsc, eslint and 172 jest
tests were green before it launched; the screenshots found six real defects in
twenty minutes. Every one was invisible to the suite.

## Getting it to build at all

- **The NDK never downloaded.** AGP's bundled SDK manager printed `Preparing
  "Install NDK…"` and then did nothing — no HTTPS connection, no bytes, no
  error. Cause: it "only understands SDK XML versions up to 3" and Google's
  repository is v4. **Fix: install `cmdline-tools` and run `sdkmanager
  "ndk;27.1.12297006"`** — it worked first time. `cmdline-tools` was missing
  from the SDK entirely.
- **Killing a half-done NDK download leaves a directory with no
  `source.properties`**, and Gradle then fails fast (`CXX1101`) instead of
  re-downloading. Delete the version directory before retrying.
- `-PreactNativeArchitectures=arm64-v8a` on the command line, never in
  `gradle.properties`: the emulator needs one ABI and a release APK needs four.
- **`local.properties` (`sdk.dir=…`) was missing** and is gitignored — it has to
  exist for any Gradle run.
- **Metro cached a syntax error and kept serving it after the file was fixed.**
  The app sat on "Loading from 10.0.2.2:8081…" while `tsc` was clean; the real
  error was only in `metro.log`. **A green typecheck says nothing about what
  Metro is serving** — restart with `--reset-cache`.

## The bug class the whole run kept finding: SILENCE

Three different silences that all rendered as the same blank space:

| what happened | what the app said |
| --- | --- |
| the list is genuinely empty | "No shops around here yet." |
| the request FAILED | *nothing* |
| the request was never MADE | *nothing* |

Nine screens had a loading state and an empty state and nothing between them,
so a dropped connection was reported to a customer as a fact about the platform
— and there is no retry on a fact. Eleven mutations had **no `onError` between
them**: a tap that saved nothing looked exactly like a tap that missed.

Fixes: `LoadFailed` on every list, and ONE handler on the query client's
`MutationCache` rather than eleven hand-written ones — with `meta: { silent:
true }` for the four screens that report failure in place, or a wrong password
is told twice in two shapes.

`searchAddress` now returns **`null` (could not ask)** vs **`[]` (asked, found
nothing)**. With no Geoapify key it returned `[]`, so the app told everybody
their street did not exist, for every street, for ever.

## Two more shapes worth remembering

- **An invented default becomes a promise.** `prep_time_minutes ?? 30` printed
  "Delivery 30–50 min" beside a shop that had set nothing. A kitchen taking
  ninety minutes is then late by the APP's arithmetic. Same family as
  [[shopos-absent-field-is-a-branch]].
- **One rule, five copies.** Distance was formatted by hand in five places and
  every one printed the server's two decimals: `945.81 km`. Also `delivery_fee
  = 0` means BOTH "free delivery" and "does not deliver" — the list payload had
  no way to tell them apart, so a pickup-only counter would have been
  advertised as free delivery. Backend now sends `delivers`.

Each fix carries a scanning test that fails when the pattern reappears; all
mutation-proven. Related: [[shopos-provider-nobody-mounted]],
[[shopos-mobile-is-customer-and-rider]].
