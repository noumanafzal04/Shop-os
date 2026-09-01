---
name: shopos-absent-field-is-a-branch
description: STANDING — an optional field every test supplies is a branch nobody has driven down; 3 live defects found that way (khata with no phone, tank with no gate, nozzle booking a meter's whole life)
metadata:
  type: feedback
---

`scripts/untested-absence.py` asks one question of every write endpoint: **is
there an optional field that every single test supplies?** If so, its ABSENCE is
a branch nobody has driven down — and a column default is waiting there.

Three live defects came out of that list in one day:

| field | what its absence meant |
|---|---|
| `POST /customers` · `phone` | a Rs 50,000 khata given to somebody the till can never name — see [[shopos-khata-needs-a-phone]] |
| `POST /fuel/tanks` · `capacity_litres` | column defaults to 0 and the overfill gate reads `capacity > 0 && …`, so the tank had **no gate at all** |
| `POST /fuel/pumps/*/nozzles` · `current_reading` | defaults to 0; a pump installed mid-life reads six figures, so the first shift books **the meter's whole life** as one day's sales |

**The pattern:** an optional field + a non-null column default = a silent wrong
answer. The nozzle one is the sharpest, because the code already guards the
NEIGHBOURING mistake — `OpenForecourtShiftAction` refuses an opening typed below
the stored reading, and cannot refuse a stored reading nobody took.

**How to apply:**
- required at CREATION, `sometimes` on an edit — renaming a tank must not demand
  its capacity back.
- zero is often a legitimate value (a brand-new pump). The rule is that somebody
  has to SAY so, not that it cannot be nought — so require the field, do not
  require it to be positive.
- make the form ask before the server has to refuse.
- count went 19 → 11 → 5 over two passes; the survivors all have plausible
  column defaults.

Related: [[shopos-edit-matrix]], [[shopos-silent-nulls]], [[shopos-detector-vs-rule]].
