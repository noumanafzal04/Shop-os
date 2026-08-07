---
name: shopos-food-dinein
description: "FOOD/Restaurant depth — dine-in backend (tables, running tabs, KOT, settle+split) SHIPPED 2026-07-23; recipe/BOM + POS UI still pending."
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-07-28T08:03:00.465Z
---

**FOOD depth build (user chose it over offline-first; offline stays LAST). Backend Phase 1–3 shipped 2026-07-23 — 480 backend tests green (was 471, +9).** See [[shopos-businessos-roadmap]], [[shopos-business-priority]], [[shopos-offline-plan]].

**Architecture decision:** dedicated `restaurant_tickets` entity (NOT reusing `Order`, which is online/delivery-shaped with a single sale_id). Reuses the *price-snapshot → settle* idea but settles NON-trusted through `CreateSaleAction` so tax + stock behave exactly like a walk-in counter sale.

**DONE (backend, tested — `RestaurantDineInTest`, 9 tests):**
- Migration `2026_07_23_000001_create_restaurant_tables`: `dining_tables`, `restaurant_tickets`, `restaurant_ticket_items` (stores BOTH raw selection for replay AND display snapshot), `kitchen_tickets` (KOT header; items carry `kitchen_ticket_id`).
- Models: `DiningTable` (occupancy DERIVED from `openTicket`, no status col), `RestaurantTicket` (BaseModel, `running_total` accessor), `RestaurantTicketItem`/`KitchenTicket` (plain Model).
- Actions `app/Actions/Restaurant/`: `OpenTicketAction` (one open tab/table → TABLE_OCCUPIED), `AddTicketItemsAction` (prices display snapshot via shared primitives — same orchestration OrderService uses; checks serving window), `FireKitchenTicketAction` (batches pending items → KOT #n), `SettleTicketAction` (full or split-by-item; each subset = its own Sale; tab CLOSES when every non-void item has a sale_id).
- **One surgical core change:** `CreateSaleAction` now honors `skip_serving_window` (settlement of an already-ordered tab must not be blocked by the food serving window). Guarded, default off.
- Controllers `DiningTableController` (apiResource + reorder, blocks delete if occupied) + `RestaurantTicketController` (index/store/show/addItems/voidItem/fire/kotPrint/settle/cancel).
- Routes: `Route::prefix('restaurant')->middleware('feature:dine_in')` — tables under `settings.manage`, tickets under `sales.manage`.
- **New `dine_in` module** added to `Modules::all()` + `BusinessTypes::FEATURES` (so TenantFactory fills it) + restaurant `features['dine_in']=true`. Gated for restaurants only; other tenants → MODULE_DISABLED. NO new permission (reused settings/sales.manage).
- KOT print blade `resources/views/kitchen/ticket.blade.php` (thermal 80mm, price-free, kitchen-facing).

**Design notes:** stock depletes at SETTLEMENT only (no KOT-time hold) — simple + safe (never oversells; INSUFFICIENT_STOCK surfaces at pay-time). Only split-by-item implemented (even-split deferred). Display running_total may differ from charged total only if a menu price changes mid-meal (settlement is authoritative).

**Dine-in POS UI SHIPPED 2026-07-25 (admin-panel 2df1a60, frontend-only; build clean).** `src/modules/dinein/`:
- `dineInService.ts` + `useDineIn.ts` (tables, ticket, openTicket, addItems, voidItem, fire, settle, cancel, createTable, deleteTable; tables poll every 15s).
- `FloorPage.tsx` (route `/tenant/dine-in`, FULL-SCREEN like POS): tables grid free/occupied (occupied shows open tab#), tap free→open-tab modal (guests)/occupied→tab, "+ Takeaway", "Edit floor" mode (add table modal name+seats / remove free table); empty-state add-table CTA.
- `TabPage.tsx` (route `/tenant/dine-in/tickets/:id`, FULL-SCREEN): 60/40 split — menu grid (reuses `catalogService.products({})` + categories, category chips + search) | running tab (KOT-status badges pending/fired/served, per-line modifiers+note, void). Modifier picker modal (min/max enforced, max_select=1→radio) for products with modifier_groups. Fire-to-kitchen (fires all pending, no item_ids). Settle modal = whole bill OR split-by-item checkboxes; **tax-aware**: subtotal/tax/total breakdown, tax ESTIMATED from `settings.default_tax_rate` (settle adds tax server-side over the pre-tax running_total, so amount_paid must include it — over-estimate is safe = books change_due; per-product-rate overrides are the only imperfect case).
- Sidebar "Dine-in" entry gated `has("dine_in")`; routes are siblings of `/tenant/pos` (outside AppLayout). Uses shared toast+confirm per [[shopos-ui-conventions]].

**Recipe / BOM SHIPPED 2026-07-25 (backend 4c4e1be, 575 green +6 RecipeBomTest; panel 2b77338, build clean).** A made-to-order food dish depletes raw ingredients on sale:
- `recipe_items` table (migration 2026_07_25_000002, mirrors combo_items: dish_product_id + ingredient_product_id + quantity + sort_order) + `RecipeItem` model + `Product::recipeItems()` / `hasRecipe()`.
- `CreateSaleAction`: recipe branch (before own-stock, after combo) — depletes each ingredient (ingredient qty × dish qty) via a NEW `InventoryService` `allow_negative` flag (dish already made → never block the sale, esp. dine-in settle; stock goes negative as a recount signal; FEFO still runs, expired fence skipped under allow_negative). Dish itself holds no stock (track_inventory=false).
- `ProcessSaleReturnAction`: recipe restore branch (ingredients back per returned portion). **CancelSaleAction needs NO recipe branch** — it was refactored to reverse recorded `stock_movements` (reference_type='sale') generically, so ingredient depletion auto-reverses.
- `SyncRecipeItemsAction` (mirror SyncComboItems: no self, no deal ingredient, no nested recipe). `recipe_items` on Store/UpdateProductRequest gated to `item_type=food_item` (prohibited otherwise). Create/UpdateProductAction persist; ProductController + PosController eager-load `recipeItems.ingredient:id,name` → serialized as `recipe_items`.
- Frontend: optional "Recipe / ingredients" Section in ProductFormPage for food items (ingredient picker + qty, mirrors the deal editor); `Product.recipe_items` + `ProductInput.recipe_items` + `RecipeItemLine` types.

**FOOD is now feature-complete for daily ops.** Deferred nice-to-haves: KOT status bump (preparing/ready/served), even-split, table merge/transfer, course timing, KOT auto-print on fire, exact-tax dine-in settle quote (avoid the default-rate estimate), recipe COGS rollup into reports.
