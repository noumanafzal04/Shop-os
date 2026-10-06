# A demo shop sells what its trade sells

**2026-10-06 · found by opening a restaurant demo to look at the floor**

The floor said "No tables yet". The menu, asked for the shop's dishes, came
back empty — with five dishes in the shop.

## The fault

`CreateDemoShopAction` wrote its products by hand and gave each
`item_type = BusinessTypes::primary($businessType)`: the BUSINESS's type in
the ITEM's column. A dish was a `food`, a medicine a `pharmacy`, a haircut a
`services`. There are five item types (`ItemTypes`) and none of those is one.
The column is a string, so nothing refused it.

- Every screen that asks for a kind of item found none.
- The product form could not save any of them back.
- A haircut was a counted product with a hundred in stock — "is this a
  service" was compared against the wrong word too.
- A books-only shop was given three products it had no screen to see.

`test_every_trade_can_open_one` was green throughout. It asserted the shop
was CREATED. Nothing asked whether what was in it could be found or sold.

## Now

The shelf goes on through `CreateProductAction` — the product form's own door
— with the type the trade is offered (`itemTypesFor($trade)[0]`). That also
puts stock where the till looks and gives a medicine its lot and expiry. A
trade offered no item types gets no shelf.

A restaurant is a floor and a menu: 12 tables in three rooms, 19 dishes in
six sections, three stations. The landing page sells that trade as "Tables,
kitchen dockets, dine-in"; the shop it opened had no table in it.

## Tests

`ADemoShopSellsWhatItsTradeSellsTest` (6). Against the old builder, five of
the six fail. It also rings the first item of six trades through `/sales`.
