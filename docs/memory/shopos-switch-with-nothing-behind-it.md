---
name: shopos-switch-with-nothing-behind-it
description: FIXED — "Require open shift" was read by nothing in the panel, so shift discipline was ALWAYS on at the till and a one-person shop could not sell at all
metadata:
  type: project
---

Audited all **50** Settings preferences for an actual reader (a count of files
mentioning a key is not a count of readers — the migration, the validator and
the allow-list all mention it). 49 had one. **`pos_require_shift` had none in
the panel.**

The till asked `canRing = activeSessionId !== null` and nothing else, so shift
discipline was **always on at the counter** whatever the shop had chosen:

- turning the switch off changed nothing observable
- the message under a disabled Tender asserted a rule the shop never set
- **a one-person shop that never opened a drawer could not ring one sale** —
  exactly what the backend test pinning the default says must not happen
  (*"enforcing it by default would stop a one-person shop from selling the day
  the check went live"*)

Fixed as `canRingASale(session, requireShift)` + `whyCannotRing()` in
posService — the gate and the sentence under the button come from one place.
Proven in a browser both directions on a shop with no open shift.

**Why:** a rule enforced server-side and *re-derived* client-side. The server
asked "does this shop want shifts?", the till asked "is there a drawer?".

**How to apply:** where a rule is enforced on the server and mirrored in the
till, the client **reads the setting** — it never re-derives the rule. The
mirror and the fence may differ on latency, never on policy.

Second bug found the same pass: [[shopos-full-screen-pinned-room]].
Related: [[shopos-promise-in-another-file]], [[shopos-dead-rules]].
