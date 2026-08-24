---
name: shopos-security-pass
description: "2026-08-15 security pass DONE both sides; 4 fixes, biggest = anyone could lock a shop out of its own till"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-15T10:13:05.436Z
---

Ran 2026-08-15 — the standing item from the 2026-08-11 backlog and item 4 of
`docs/audit-2026-08-12/VERIFIED.md`. Full write-up in
`docs/decisions/security-pass.md`, with the denominator beside every surface.

Four fixes, biggest first:

1. **Anyone could lock a shop out of its own till.** The failed-attempt lock was
   checked BEFORE the password, and that guard is shared by both login paths —
   five wrong guesses against a known email took the shop off its POS (password
   *and* OTP) for 15 minutes, from anywhere, repeatable. Now the lock refuses a
   wrong password and never a right one.
2. **Changing somebody's password bypassed the escalation guard** — a manager
   who could not tick a permission box could set that person's password and sign
   in as them. Email/phone were the same door. Rule now: *you may only take over
   an account you could have created.*
3. `code128Svg` interpolated its input into `<text>` — no caller today, escaped
   anyway, because its sibling is rendered via `dangerouslySetInnerHTML`.
4. `vehicle_id` was not tenant-scoped — explicitly **not** an exposure.

**Why this is worth remembering:** the first authorization sweep reported that
zero of 215 mutating routes were authenticated. `route:list --json` returns
resolved middleware CLASS names, not aliases. A surface where nothing at all is
authenticated is not a finding, it is a broken measuring stick — see
[[shopos-denominator-rule]]. Rerun properly: 185 of 209 carry `EnsurePermission`.

Accepted, not fixed: tokens in `localStorage` (ordinary SPA trade-off; moving
off it means httpOnly cookies + CSRF on every write).

NOT covered and still owed: dependency CVEs (`composer audit` / `npm audit`),
and infrastructure — which cannot be audited until there is a domain and TLS.

## The CVE pass, 2026-08-24 — and why it stopped being an errand

Run: `composer audit` clean, `npm audit` clean. That snapshot is worth little on
its own, so both deploy workflows now run it as a GATE before deploying:
`composer audit --locked` (advisories are about the lockfile) and
`npm audit --omit=dev --audit-level=high` (this gate is about what reaches a
shop's browser; a build tool's advisory is not worth blocking a 2am deploy).

**Proven by polarity, not by a clean run:** `minimist@0.0.8` and
`guzzlehttp/guzzle@6.5.0` both make the exact gate command exit 1, while our two
repos exit 0. `0 vulnerabilities` and "the audit never ran" print identically —
see [[shopos-measurement-that-lied]], including the `$?`-after-a-pipe trap that
made a working gate look inert.

Doc: `docs/decisions/shopos-a-pass-is-not-a-gate.md`.

