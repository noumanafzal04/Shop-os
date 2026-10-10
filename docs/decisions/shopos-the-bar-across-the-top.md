# The bar across the top

**2026-10-10 · asked by the owner in three lines: "on top header Branch
dropdown make more perfect" · "and also search bar" · "mean overall top
header"**

"More perfect" is not a specification, so the first hour was looking — four
widths, the menu open, search open — and writing down what was actually
wrong. Most of it was not polish.

## Search

| What it was | What it is |
|---|---|
| Said "Search or jump to…" and could not jump: "expenses" found nothing | Offers the shop's SCREENS — the rail's own list, so the same modules and permissions — ahead of the records it finds |
| Opened empty with "Type at least two characters" | Opens with *Go to*: where a day starts |
| Said "⌘ K" to everybody | "Ctrl K" on a PC, which is what a shop's counter is; ⌘ K on a Mac |
| Sized to its own placeholder: 230px in a 1,076px bar | Takes the room there is, up to 30rem, and gives it back first |
| An icon from `sm`; on a PHONE, nothing | An icon below `lg`, phone included |
| "0 results" under four screens it had just found | Counts what is on offer |

The screens come from `useShopNav()` — the rail's inputs gathered once
(`useNavInputs`) rather than written out a second time, which is how two
menus come to disagree about the same cashier. Always the full menu,
whatever the rail is set to: somebody who keeps the short menu and types
"stocktake" is asking for a screen they have.

## The branch

This control exists to stop somebody reading one branch's stock while
believing they are reading the shop's. It said so in the same grey either
way: only the word changed.

- **Chosen, it is tinted** (`data-scope="branch"`) — the shop's colour, with
  a filled mark. On a phone, where there is no room for the name, the tint
  is the news.
- The menu says what each row IS: *All branches — Head office, every branch
  together*; a branch's city or address; one tag at most. The default branch
  was tagged with its own name — "Main — Main" — and is *Default*, or *Main
  branch* where it has a name of its own. A closed branch says Closed.
- **A keyboard can use it.** Down opens it like a select; arrows, Home, End,
  Enter, Escape; focus goes back to the control. `aria-haspopup`,
  `aria-expanded`, a `listbox` of `option`s with `aria-selected`.
- From seven branches there is a box to find one in.
- *Manage branches* at its foot.
- **On a phone it was not drawn at all** (`hidden sm:block`). An owner
  standing in the second branch with a phone could neither see nor change
  which branch the figures in their hand belonged to. It is drawn, and its
  menu is pinned to the screen there — hung from the control it ran off the
  left edge, because the control is not at the right one.

Staff are still only TOLD their branch. That is the owner's decision, made
on the Staff screen.

## Room for both on a phone

Search and the branch are 88 pixels a 390px bar did not have. The product's
NAME gives way below 480 on the shop side (the mark stays; the link keeps
its name for a screen reader), the account button is the avatar alone below
360, and a waiting update is an arrow below 480. Measured at 320: nothing
past the edge.

## Held in place

`branchMenu.test.ts`, `screens.test.ts`, `shortcut.test.ts`;
`e2e/header.spec.ts` drives the branch control from the keyboard, reads the
`X-Branch-Id` the next request carries, compares the tinted and untinted
colours, and opens both menus at 390 and 320. `narrow-phone.spec.ts` now
expects the name back at 480.

Panel only. No migration.
