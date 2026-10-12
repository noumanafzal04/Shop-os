<?php

namespace App\Actions\Restaurant;

use App\Enums\FulfillmentType;
use App\Enums\RestaurantTicketStatus;
use App\Models\KitchenTicket;
use App\Models\Order;
use App\Models\Product;
use App\Models\RestaurantTicket;
use App\Models\Tenant;
use App\Support\ItemTypes;

/**
 * AN ORDER TAKEN ON THE PHONE, OR PLACED ONLINE, REACHES THE KITCHEN.
 *
 * ── What was there ───────────────────────────────────────────────────
 *
 * A table's order reaches the pass when it is fired. A takeaway rung at the
 * counter reaches it when it is paid (`SendCounterOrderToKitchen`). An order
 * in the Orders queue — a customer on the phone, a basket from the online
 * shop — reached nobody: the shop pressed "Start preparing" and the kitchen's
 * board stayed empty. Somebody had to walk over and say it.
 *
 * Found by taking one phone order through its life in a restaurant and then
 * looking at the pass.
 *
 * ── When ─────────────────────────────────────────────────────────────
 *
 * The moment the order is BEING PREPARED — the shop's own word for "the
 * kitchen starts now". Not when it is placed: an order nobody has accepted is
 * not yet a meal to cook.
 *
 * ── What it is, on the board ─────────────────────────────────────────
 *
 * A ticket that never had a table: `from_counter`, so it stays off the floor
 * and closes itself when its last docket is served, exactly as a counter
 * order does. It carries the ORDER's number — what the rider and the customer
 * will ask for — and the customer's name, which is what the pass calls out.
 * The docket says whether it is going out with a rider or being collected.
 *
 * It is tied to its order by that number: `ticket_number` is the order's own
 * `order_number`, unique in the shop. An order is sent once.
 */
class SendAnOrderToTheKitchen
{
    public function execute(Order $order): ?RestaurantTicket
    {
        $shop = Tenant::query()->find($order->tenant_id);

        // A shop with no kitchen has no pass to send it to.
        if ($shop === null || ! $shop->featureEnabled('kitchen')) {
            return null;
        }

        if ($this->ticketOf($order) !== null) {
            return null; // sent already — a status pressed twice is not two meals
        }

        $lines = $this->whatTheKitchenMakes($order);
        if ($lines->isEmpty()) {
            return null; // a bottle of water and a bag of crisps is not a docket
        }

        $ticket = RestaurantTicket::withoutTenancy()->create([
            'tenant_id' => $order->tenant_id,
            'ticket_number' => $order->order_number,
            'dining_table_id' => null,
            'branch_id' => $order->branch_id,
            'from_counter' => true,
            // To go, whichever way it goes: the pass packs both the same.
            'order_type' => 'takeaway',
            'status' => RestaurantTicketStatus::Open,
            'waiter_id' => $order->created_by,
            'customer_name' => $order->customer_name,
            'customer_phone' => $order->customer_phone,
            'opened_at' => now(),
        ]);

        foreach ($lines as $line) {
            $ticket->items()->create([
                'tenant_id' => $order->tenant_id,
                'product_id' => $line->product_id,
                'variant_id' => $line->variant_id,
                'quantity' => $line->quantity,
                'product_name' => $line->product_name,
                'variant_name' => $line->variant_name,
                'unit_price' => $line->unit_price,
                'line_total' => $line->line_total,
                'modifiers' => $line->modifiers,
                'kot_status' => 'pending',
            ]);
        }

        app(FireKitchenTicketAction::class)->execute($ticket->refresh(), [
            'notes' => $this->whatTheDocketSays($order),
        ]);

        return $ticket->load('items', 'kitchenTickets');
    }

    /**
     * The order was cancelled: whatever is still cooking comes off the pass.
     *
     * A docket already served is left alone — cancelling an order cannot
     * un-cook the food, and the kitchen's record of what it sent out stays
     * true. The same rule a cancelled tab keeps.
     */
    public function takeBack(Order $order): void
    {
        $ticket = $this->ticketOf($order);
        if ($ticket === null) {
            return;
        }

        KitchenTicket::withoutTenancy()
            ->where('ticket_id', $ticket->id)
            ->whereIn('status', KitchenTicket::ACTIVE)
            ->update(['status' => 'void']);

        $ticket->items()->whereNull('voided_at')->update([
            'voided_at' => now(),
            'kot_status' => 'void',
            'void_reason' => 'Order cancelled',
        ]);

        if ($ticket->isOpen()) {
            $ticket->forceFill(['status' => RestaurantTicketStatus::Void, 'closed_at' => now()])->save();
        }
    }

    private function ticketOf(Order $order): ?RestaurantTicket
    {
        return RestaurantTicket::withoutTenancy()
            ->where('tenant_id', $order->tenant_id)
            ->where('ticket_number', $order->order_number)
            ->where('from_counter', true)
            ->first();
    }

    /** Only what a kitchen cooks: a dish, not the packet beside it. */
    private function whatTheKitchenMakes(Order $order)
    {
        $items = $order->items()->get();

        $food = Product::withoutTenancy()
            ->withTrashed()
            ->where('tenant_id', $order->tenant_id)
            ->whereIn('id', $items->pluck('product_id')->filter()->unique())
            ->where('item_type', ItemTypes::FOOD)
            ->pluck('id');

        return $items->filter(fn ($line): bool => $food->contains($line->product_id));
    }

    /** "Delivery" or "Pickup", and whatever the customer asked for. */
    private function whatTheDocketSays(Order $order): string
    {
        $how = $order->fulfillment_type === FulfillmentType::Delivery ? 'Delivery' : 'Pickup';
        $asked = trim((string) $order->notes);

        return $asked === '' ? $how : "{$how} — {$asked}";
    }
}
