---
name: shopos-work-screens-follow-the-till
description: USER feedback 2026-10-12 (three rounds on Take-order) — a screen somebody WORKS on is laid out like the POS: fixed-height workspace, panes that scroll inside, totals + the one button in a strip along the bottom; not "all white", nothing pushed down by loading more
metadata:
  type: feedback
---

On 2026-10-12 the user sent the Take-order page back three times:
1. "zeyda cheezaion add krny sy cart niche ja raha jb data load krty more
   products" — the order sat UNDER the menu and sank with every "Show more".
2. "take order page full white sa nzr araha, take order side b pta ni chal rhi"
   — two white cards; nothing said which side was the order.
3. After a tinted menu + a tall "ticket" panel: "abhi b acha ni hai — POS ki
   screen dekhlo — cheezaion bht zyeda scroll main ja rhi".

What they accepted as the direction (built the same evening): **the till's
arrangement** — menu pane | order pane, each scrolling INSIDE itself, the page
not scrolling at `lg`+, who-it-is-for as compact single-line fields above the
lines, and a bottom strip with the figures, the total and one big button.
Same day, for the Orders list: "make tab — Today and Past orders, past orders
in table form" (see [[shopos-an-order-reaches-the-kitchen]]).

**Why:** a cashier or order-taker works with both hands and a caller on the
line; anything that scrolls out of sight is lost. They compare every work
screen to the POS, which they like ([[shopos-pos-ux]], [[shopos-ui-direction-oct06]]).

**How to apply** (my reading — the user's words are the quotes above):
- A new or reworked WORK screen (take order, new sale, receive goods, a tab)
  starts from the POS layout, not from a form page. Look at the POS first.
- Test it by adding MANY things and pressing "Show more": the page must not
  scroll and the total + button must stay in the viewport (the assertion is in
  `e2e/food.take-order.spec.ts`).
- A pane that sits beside another answers to its OWN width (`@container`), not
  the window's — at 1024 a half-screen pane is ~470px.
- Show a screenshot-level result early; do not polish a layout they have not
  seen. Lists of history are tables; what is being worked is a board.
