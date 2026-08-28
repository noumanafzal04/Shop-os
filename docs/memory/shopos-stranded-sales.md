---
name: shopos-stranded-sales
description: FIXED — sales stamped with NO tenant were counted by the badge and never sent, for ever; the fence was right, its promise "can be recovered" was not true
metadata:
  type: project
---

Live report: *"still showing 7 to till, clicking sync does nothing."*

The till stamps `tenantId: user?.tenant?.id ?? null`. If the auth store has not
hydrated its tenant when Complete is pressed (offline boot, reload mid-outage,
older build), the row is written with **no shop**. Then:

- `owedCount()` counts it — it counts everything unfinished, **no tenant filter**
- `dueRows()` never offers it — `belongsHere` demands an exact match
- so the badge says 7, every press of Sync sends nothing, **for ever**, silently

**I nearly "fixed" this by adopting unstamped rows automatically. Two existing
tests stopped me**, and their reasoning is right: *"a stuck row can be read,
counted and recovered; a row filed under the wrong business cannot."*

**The fence is correct. What was false was the first half of that sentence** —
nothing read them, nothing counted them apart, nothing recovered them.

So instead: `strandedRows()` + `strandedReason()` name them, the sync control
says **"N stuck — needs attention"** (not "still to send", which invites
pressing a button that can never work), and `adoptStranded()` is an explicit
owner action in Settings → POS → Lanes & PINs. It adopts **only rows naming NO
shop** — never another shop's — behind a confirm that says the till cannot know.

**How to apply:** when a guard holds something back "safely", check that the
recovery it justifies itself with actually exists. A silent hold is a silent
loss. See [[shopos-sync-that-lied]], [[shopos-till-had-no-offline-shell]].
