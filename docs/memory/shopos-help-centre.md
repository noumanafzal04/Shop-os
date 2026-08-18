---
name: shopos-help-centre
description: "In-app Help Centre — full-screen, per-tenant filtered by module/trade/permission; STANDING RULE: update it whenever a screen changes"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-11T12:43:49.812Z
---

Shipped 2026-08-11. An in-app Help Centre, not a markdown file — the user
explicitly rejected docs-only ("not in md file make a help center type screen").

## Shape

- `src/modules/help/content.ts` — articles as DATA. Each declares `modules`,
  `trades`, `permission`, `screen`, `keywords`, and a `body` of typed blocks
  (`h` / `p` / `steps` / `list` / `keys` / `table` / `note` / `warn`).
- `src/modules/help/pages/HelpCenterPage.tsx` — **full screen**, outside
  AppLayout (like the POS). Own header with logo + "Help Centre" + **Back to
  portal**. Left: search + grouped topic rail. Centre: article. Right: "On this
  page", built from `h` blocks and tracked with an IntersectionObserver.
- Routes `/tenant/help` and `/admin/help`. **Authenticated, not public** — the
  user tried public then reversed it ("no public"), because each shop owner must
  see content matching their own business type.
- Reachable from the sidebar (last item, ungated) and the avatar menu.

## The rule that makes it work

Filtered on the SAME three axes as the sidebar: module → trade → person. A
restaurant is never shown how to count stock; a kitchen hand is never shown the
till. Help describing a screen you do not have reads as a fault in the software,
not as a stale document.

`content.test.ts` pins per-trade and per-person filtering, AND completeness
(20 tests). Mutation-checked: deleting the module filter fails 4 of them.

**48 articles cover 43 of 44 tenant screens** (the 44th is the Help Centre
itself). A `covers every screen the shop has` test fails the build when a new
screen ships undocumented — checked against `src/test/routes.ts`, with a written
`NEEDS_NO_ARTICLE` exemption list so "I forgot" cannot look like "needs none".

Sub-screens nest via a `parent` field (12 of them): Stock count and Transfers
under Inventory, Suppliers under Purchases, Sales-by-hand under the sales
ledger, and so on. A test proves a child is never shown when its parent was
filtered out — that would leave it in the rail with nothing to hang under.

## STANDING RULE (user's words: "whenever any change/update in code we will also update help center screen")

A change to a screen is a change to the Help Centre. Update the article in the
same pass, and give it the same `modules`/`trades`/`permission` the screen
carries. Also recorded in HANDOVER.md §"Rules that must not be broken".

## Companion docs (kept, they serve a different reader)

- `BUSINESS-FLOWS.md` — who gets which screen per trade; the preset→permission→
  screen chain; answers "kitchen ki screen kisko deni?"
- `MODULE-GUIDE.md` — the same content in long form for a developer/handover
- `BUSINESS-TYPE-WORKFLOWS.md` — pre-existing developer contract

Related: [[shopos-no-roles]], [[shopos-read-vs-manage]], [[shopos-ui-conventions]].
