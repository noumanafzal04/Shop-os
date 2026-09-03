<?php

namespace App\Actions\Restaurant;

use App\Enums\RestaurantTicketStatus;
use App\Models\Product;
use App\Models\RestaurantTicket;
use App\Models\Sale;
use App\Support\ItemTypes;
use App\Support\TenantContext;

/**
 * A TAKEAWAY ORDER RUNG AT THE TILL, SENT TO THE KITCHEN.
 *
 * ── The gap this closes ─────────────────────────────────────────────────
 *
 * A kitchen ticket could only ever be created by a dine-in tab's Fire. So a
 * café that rings a takeaway order at the counter — the ordinary case, and what
 * a small café does all day — printed a receipt for the customer and told the
 * kitchen nothing. The only way to get a slip to the pass was to run every
 * order as a tab on a table that does not exist.
 *
 * ── Why it builds a ticket rather than a second shape ───────────────────
 *
 * Everything the kitchen does is already built on a ticket: the board reads
 * KOTs through theirs, the bump lifecycle stamps its items, the KOT print
 * renders from it, and `KitchenTicket::forAnOpenTab` is what stops a docket
 * outliving the order it belongs to. A parallel "food a till sold" shape would
 * need every one of those written again, and the two would disagree the first
 * time either changed.
 *
 * ── What does NOT go to the kitchen ─────────────────────────────────────
 *
 * A bottle of water off the chiller is not work for the pass, and a board full
 * of things nobody cooks is a board the kitchen stops reading. Only items the
 * shop classifies as food go — the same `item_type` the menu is built on.
 * A sale with none of them creates no ticket at all, which is why a mart with
 * the module switched on is not quietly given a floor.
 *
 * ── Why it is left OPEN ─────────────────────────────────────────────────
 *
 * It is paid before the kitchen has seen it, so there is no settlement left to
 * make — but closing it here would drop the docket off the board the instant it
 * was fired. It stays open until the kitchen has served the last docket on it;
 * see BumpKitchenTicket.
 */
class SendCounterOrderToKitchen
{
    public function __construct(private readonly TenantContext $context) {}

    /** @return RestaurantTicket|null null when there was nothing for the kitchen to do */
    public function execute(Sale $sale): ?RestaurantTicket
    {
        $tenant = $this->context->get();

        if ($tenant === null || ! $tenant->featureEnabled('kitchen')) {
            return null;
        }

        // Dine-in has its own path: a tab fires as the waiter sends each course,
        // and by the time it becomes a Sale the food has long been cooked.
        if (($sale->order_type ?? null) !== 'takeaway') {
            return null;
        }

        // A practice sale takes nothing off a shelf and must not put a real
        // order in front of a real kitchen either.
        if ($sale->is_training) {
            return null;
        }

        $lines = $this->whatTheKitchenMakes($sale);

        if ($lines->isEmpty()) {
            return null;
        }

        /** @var RestaurantTicket $ticket */
        $ticket = RestaurantTicket::query()->create([
            // THE SALE'S OWN NUMBER, not a TAB one.
            //
            // It is what the counter can match a bag to, and what the customer
            // is holding — a cook calling "TAB-00042" is reading a number
            // nobody in the shop has seen. It also avoids the floor's
            // `count() + 1`, which two tills ringing at once can land on twice;
            // untidy on a floor, and a good deal likelier at a busy counter.
            'ticket_number' => $sale->invoice_number,
            'dining_table_id' => null,
            'branch_id' => $sale->branch_id,
            // Settled by exactly this one sale — the same thing the column
            // means for a tab, filled honestly and early.
            'sale_id' => $sale->id,
            // And the fact the floor needs, which `sale_id` does not carry:
            // this was never a tab. See the migration for why they are two
            // columns and not one.
            'from_counter' => true,
            'order_type' => 'takeaway',
            'status' => RestaurantTicketStatus::Open,
            // Whoever rang it. The service report reads this, and "nobody"
            // would be a row an owner cannot ask anybody about.
            'waiter_id' => $sale->served_by ?? $sale->created_by,
            'customer_name' => $sale->customer_name,
            'customer_phone' => $sale->customer_phone,
            'opened_at' => $sale->sold_at ?? now(),
        ]);

        foreach ($lines as $line) {
            $ticket->items()->create([
                'tenant_id' => $tenant->id,
                'product_id' => $line->product_id,
                'variant_id' => $line->variant_id,
                'quantity' => $line->quantity,
                'product_name' => $line->product_name,
                'variant_name' => $line->variant_name,
                'unit_price' => $line->unit_price,
                'line_total' => $line->line_total,
                'modifiers' => $line->modifiers,
                // ALREADY PAID. Nothing may settle this a second time, and the
                // cancel path refuses a tab whose items carry a sale.
                'sale_id' => $sale->id,
                'kot_status' => 'pending',
            ]);
        }

        app(FireKitchenTicketAction::class)->execute($ticket->refresh());

        return $ticket->load('items', 'kitchenTickets');
    }

    /**
     * The lines a kitchen actually has to make.
     *
     * From the PRODUCT, and there is a trap here worth writing down:
     * `sale_items.item_type` looks like the answer and is not. It stores the
     * coarse `products.type` — product or service — while the fine
     * classification the menu is built on (`food_item`, `physical_product`,
     * `medicine`…) lives on the product itself. Filtering on the line silently
     * matched nothing and the kitchen was told nothing, which is exactly the
     * failure this whole change exists to end.
     *
     * `withTrashed()` because a dish deleted from the menu an hour after it was
     * ordered must still reach the pan it was ordered for.
     */
    private function whatTheKitchenMakes(Sale $sale)
    {
        $items = $sale->items()->get();

        $food = Product::query()
            ->withTrashed()
            ->whereIn('id', $items->pluck('product_id')->filter()->unique())
            ->where('item_type', ItemTypes::FOOD)
            ->pluck('id');

        return $items->filter(fn ($line): bool => $food->contains($line->product_id));
    }
}
