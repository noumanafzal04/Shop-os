---
name: shopos-takeaway-slip
description: takeaway = POS default order_type; server fires the KOT; the SLIP now prints too (kot_auto_print was read only by the dine-in Fire button)
metadata:
  type: project
---

**Where takeaway is handled**, end to end — the user could not find it:

1. **POS**, `orderType` defaults to `"takeaway"` — nothing to select. The
   takeaway/dine-in toggle only appears for a food shop with `dine_in` **OFF**
   (`PosPage.tsx`, `isRestaurant && !has("dine_in")`); where a floor exists,
   dine-in belongs on it.
2. Tender → `CreateSaleAction` → `SendCounterOrderToKitchen`: fires a KOT if
   `kitchen` is on, `order_type === 'takeaway'`, not training, and there is at
   least one **food** line (from `products.item_type`, NOT `sale_items.item_type`
   — that holds the coarse `products.type`). `from_counter = true`.
3. Docket lands on the pass `/tenant/kitchen`, headed by the customer's name or
   the word "Takeaway", wearing the **sale's invoice number**. Not on the floor.
   Served ⇒ closed.
4. **2026-09-03: the SLIP prints too.** `kot_auto_print` had exactly one reader —
   the dine-in tab's Fire button — so a counter with no floor obeyed a setting
   nobody asked it about. `CreateSaleAction::$kitchenTicket` names the docket,
   the till's controller merges it into the sale response, and the till prints
   through `dineInService.printKots` (same renderer as the floor). Skipped
   offline: server-rendered.

Two gates were still on the floor and are now on the pass: the Settings → POS →
**Kitchen** tab, and `GET /restaurant/tickets/{ticket}/kot/{kot}` — see
[[shopos-offered-must-be-reachable]].
