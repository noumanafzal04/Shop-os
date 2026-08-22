---
name: shopos-reply-style
description: STANDING — user does not read long replies; always end with a SHORT summary block (what I did / what's next) in bullet points
metadata:
  type: feedback
---

**Said 2026-08-18:** *"main sari chat response ni prhta tmrhi — mjhe last py short
summry and point dia kro meree liyee: kya kia, kya next"*

Every reply ends with a short bullet summary:

- **Kya kiya** — 2-4 bullets, plain
- **Kya next** — 1-3 bullets
- **Aap ko kya karna hai** — only when there IS an action for them

**Why:** long prose replies go unread, so the substance is lost even when the
work is right. A finding nobody reads is the same as no finding — the same shape
as everything else in this project ([[shopos-reachability-rule]]).

**How to apply:** keep the body as short as the work allows, then the summary
block. Detail belongs in `docs/decisions/` and `HANDOVER.md`, which is where it
survives anyway — see [[shopos-docs-discipline]]. Do not pad the summary with
what was already said in the body; it should stand alone.

**ALWAYS end with three things, in this order** (asked for again 2026-08-22,
"last py bataya kro kya kia kya rehta next"):

1. ✅ **Kya kiya** — what actually got done this turn
2. ⏭️ **Kya rehta hai** — what is still open, including anything running in the
   background right now
3. 👉 **Next** — the single next step, or the one decision needed from them

Not optional and not only at the end of a big task — every substantive reply.
The user tracks this project by these three lines, so a reply that ends without
them makes them ask for the status again, which is the signal that it was
missing.
