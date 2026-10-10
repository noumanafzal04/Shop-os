# Saved — and worth knowing

**2026-10-10 · the fourth of the items left after the queue**

An expense or an income can be recorded and still have something to say: a
budget it took the month past, cash with no drawer open to take it from. The
server sends those back as `meta.warnings` on a SUCCESSFUL save. The two
forms each did something different with them, and each was wrong:

**The expense form held itself open.** It showed the warning under the word
"Saved" — and left *Save expense* live beside it, over a form still full of
the bill that had just been filed. One more press and it was filed twice.
The only thing that had changed was that *Cancel* read *Done*.

**The income form closed.** It put the FIRST warning in a toast INSTEAD of
"Income recorded" — so a save with a warning never said it had saved, any
second warning was dropped, and the one that was shown was gone in four
seconds. Editing an entry never looked at the warnings at all.

One behaviour now, in both (`expenses/savedNotes.ts`,
`expenses/components/SavedNotice.tsx`):

- the toast says the entry was recorded — always;
- the form stays up and says so in its title, with **every** warning on it;
- its fields are locked (`<fieldset disabled>`): it is a record now, not a
  form;
- one button, and it is *Done*.

Held open rather than closed, because a warning about money is not something
to show for four seconds. Locked rather than live, because a form that has
saved must not be able to save again.

`e2e/saved-with-a-note.spec.ts` lets a real save through, puts two notes on
its answer as it comes back, and counts: one request, one entry in the
books, no Save button, both notes on the form.

Panel only. No migration.
