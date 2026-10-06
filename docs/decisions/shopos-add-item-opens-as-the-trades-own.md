# "Add item" opens as the trade's own kind

**2026-10-06 · found by the restaurant's journey, case H2**

The journey filled in a dish and looked for "Made at", to give it a kitchen
station. It was not on the form.

## The fault

The form began on `physical_product` and only moved off it when the shop was
not ALLOWED physical products at all. A restaurant is — it may sell a bottle
off the chiller — so a restaurant's "Add item" opened on Physical product,
stock tracked, opening stock nought. Whoever did not notice the row of type
buttons above the name saved a "dish" that:

- could not be sold (tracked at zero: the till refuses it as out of stock);
- had no "Made at", no recipe, none of a dish's sizes and extras.

A chemist's opened the same way: a medicine saved as a product has no batch
and no expiry.

The comment above the code said "default the item type to the first the
business supports". The code did "leave it alone if it is supported at all".

## Now

`catalog/startingItemType.ts`: the form opens on the FIRST kind the server
offers the shop (`BusinessTypes::itemTypesFor` puts the trade's own first),
and follows that list until somebody presses a type themselves. The type
buttons say which is pressed (`aria-pressed`).

## Two more from the same run

- **H7** — an unnamed takeaway's kitchen card was headed "Takeaway", like
  every other; the receipt number in the customer's hand was not on it. The
  board is sent `customer_name` (null when none) and heads such a card with
  the receipt number. The QA walkthrough had promised that for weeks.
- **H3** — after the first table was added, "+ Add table" vanished with the
  empty floor. Adding a table now leaves the layout open until Done.

## Tests

`startingItemType.test.ts` (5), `KitchenPage.test.tsx` (+3),
`CounterOrderReachesTheKitchenTest` (+1), and the journey's stage H: 8 cases,
16 of 16 with stages A and B on a fresh shop.
