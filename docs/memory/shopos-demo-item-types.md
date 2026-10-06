---
name: shopos-demo-item-types
description: FIXED: every "Try the demo" shop was stocked with item_type = the BUSINESS type (invalid); restaurant demo had no tables; green test only asserted "created"
metadata:
  type: project
---

**Found 2026-10-06** by opening a restaurant demo to look at the floor: "No tables yet", and `GET /products?item_type=food_item` empty with five dishes in the shop.

`CreateDemoShopAction::stockTheShelf` hand-wrote products with `item_type = BusinessTypes::primary($type)` — `food`, `pharmacy`, `services`… none of which is an item type (the five are in `ItemTypes`). String column, nothing refused it. A haircut was a tracked product with 100 in stock; finance got three unsellable products.

**Now:** goes through `CreateProductAction` with `BusinessTypes::itemTypesFor($type)[0]`; a trade with no item types gets no shelf; a food demo gets 12 tables / 3 rooms, 19 dishes / 6 sections (firstOrCreate — a new restaurant already has "Beverages", "Desserts"), stations Grill/Tandoor/Bar.

**Why it lived:** `test_every_trade_can_open_one` asserted 201. [[shopos-outcome-not-coverage]] again — `ADemoShopSellsWhatItsTradeSellsTest` now rings the first item of six trades.

**Use it:** a demo restaurant (via `/demo` in the panel) is the quickest shop with realistic data for looking at food screens.

Related: [[shopos-the-front-door]], [[shopos-demo-world-stale]]
