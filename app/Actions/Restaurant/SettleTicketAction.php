<?php

namespace App\Actions\Restaurant;

use App\Actions\Sale\CreateSaleAction;
use App\Enums\RestaurantTicketStatus;
use App\Exceptions\DomainException;
use App\Models\RestaurantTicket;
use App\Models\Sale;
use Illuminate\Support\Facades\DB;

/**
 * Settle a tab into a Sale. Pass a subset of item ids to split the bill —
 * each call rings its own Sale (proper invoice + receipt + stock decrement),
 * and the tab CLOSES once every non-void item has been paid. So:
 *   - no item_ids  → full settlement (one Sale, tab closes)
 *   - item_ids A, then item_ids B (the rest) → split-by-item (two Sales)
 *
 * The Sale is rung through CreateSaleAction NON-trusted (server-authoritative
 * pricing + tax, identical to a walk-in counter sale) with skip_serving_window
 * so an item ordered earlier isn't rejected at pay-time.
 */
class SettleTicketAction
{
    public function __construct(private readonly CreateSaleAction $createSale)
    {
    }

    /**
     * @return array{sale: Sale, ticket: RestaurantTicket}
     */
    public function execute(RestaurantTicket $ticket, array $data): array
    {
        if (! $ticket->isOpen()) {
            throw DomainException::conflict('This tab is already closed.', 'TICKET_NOT_OPEN');
        }

        return DB::transaction(function () use ($ticket, $data): array {
            // The items this settlement covers: unsettled, non-void, and (for a
            // split) within the requested subset. Locked so two cashiers can't
            // settle the same items twice.
            $query = $ticket->items()
                ->whereNull('voided_at')
                ->whereNull('sale_id')
                ->lockForUpdate();

            if (! empty($data['item_ids'])) {
                $query->whereIn('id', $data['item_ids']);
            }

            $items = $query->get();

            if ($items->isEmpty()) {
                throw DomainException::unprocessable(
                    'Nothing to settle — these items are already paid or voided.',
                    'NOTHING_TO_SETTLE',
                );
            }

            $tableNo = $ticket->table !== null ? substr($ticket->table->name, 0, 16) : null;

            /** @var Sale $sale */
            $sale = $this->createSale->execute([
                'channel' => 'pos',
                'cash_session_id' => $data['cash_session_id'] ?? null,
                'order_type' => $ticket->order_type,
                'table_no' => $tableNo,
                'customer_name' => $data['customer_name'] ?? $ticket->customer_name,
                'customer_phone' => $data['customer_phone'] ?? $ticket->customer_phone,
                'items' => $items->map(fn ($i) => array_filter([
                    'product_id' => $i->product_id,
                    'variant_id' => $i->variant_id,
                    'product_unit_id' => $i->product_unit_id,
                    'quantity' => (float) $i->quantity,
                    'price_level' => $i->price_level,
                    'modifier_option_ids' => $i->modifier_option_ids ?? [],
                    'line_discount' => (float) $i->line_discount,
                    'line_discount_pct' => $i->line_discount_pct !== null ? (float) $i->line_discount_pct : null,
                ], fn ($v) => $v !== null))->all(),
                'discount' => $data['discount'] ?? 0,
                'coupon_code' => $data['coupon_code'] ?? null,
                'payments' => $data['payments'] ?? [],
                'payment_method' => $data['payment_method'] ?? null,
                'amount_paid' => $data['amount_paid'] ?? 0,
                'notes' => $data['notes'] ?? "Dine-in tab {$ticket->ticket_number}",
                // A tab item was ordered while in its serving window; paying the
                // bill later must never be blocked by that window.
                'skip_serving_window' => true,
            ]);

            // Mark exactly the settled items as paid by this sale.
            foreach ($items as $item) {
                $item->update(['sale_id' => $sale->id]);
            }

            // Tab closes when no unpaid, non-void items remain.
            $stillOpen = $ticket->items()
                ->whereNull('voided_at')
                ->whereNull('sale_id')
                ->exists();

            if (! $stillOpen) {
                // If the whole tab resolved to a single sale, link it directly;
                // a split tab keeps its linkage on the per-item sale_id.
                $saleIds = $ticket->items()->whereNull('voided_at')->distinct()->pluck('sale_id')->filter();

                $ticket->forceFill([
                    'status' => RestaurantTicketStatus::Closed,
                    'closed_at' => now(),
                    'sale_id' => $saleIds->count() === 1 ? $saleIds->first() : null,
                ])->save();
            }

            return ['sale' => $sale->load('items', 'payments'), 'ticket' => $ticket->fresh(['table', 'items'])];
        });
    }
}
