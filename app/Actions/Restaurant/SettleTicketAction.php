<?php

namespace App\Actions\Restaurant;

use App\Actions\Sale\CreateSaleAction;
use App\Enums\RestaurantTicketStatus;
use App\Exceptions\DomainException;
use App\Models\RestaurantTicket;
use App\Models\RestaurantTicketItem;
use App\Models\Sale;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Settle a tab into a Sale. Pass a subset of item ids to split the bill —
 * each call rings its own Sale (proper invoice + receipt + stock decrement),
 * and the tab CLOSES once every non-void item has been paid. So:
 *   - no item_ids  → full settlement (one Sale, tab closes)
 *   - item_ids A, then item_ids B (the rest) → split-by-item (two Sales)
 *
 * The Sale is rung through CreateSaleAction on the TRUSTED path, carrying the
 * tab's captured price snapshot (unit_price / line_total / modifiers) exactly
 * as OrderService::complete does for online orders. The customer pays what the
 * running total showed them ALL MEAL — a mid-service menu edit (86'ing the
 * item, changing its price or modifier groups) can neither block settlement
 * nor silently change the bill. Tax is still computed fresh server-side.
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
            if (! empty($data['splits'])) {
                // Split-by-quantity: settle part of one or more lines. A line
                // settled below its full quantity is divided in two — a paid
                // portion (rung on this sale) and an unpaid remainder that
                // stays on the open tab.
                $items = $this->resolveSplits($ticket, $data['splits']);
            } else {
                $query = $ticket->items()
                    ->whereNull('voided_at')
                    ->whereNull('sale_id')
                    ->lockForUpdate();

                if (! empty($data['item_ids'])) {
                    $query->whereIn('id', $data['item_ids']);
                }

                $items = $query->get();
            }

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
                // The tab's captured snapshot IS the bill — replayed on the
                // trusted path so live menu state can't reprice or reject it.
                'items' => $items->map(fn ($i) => array_filter([
                    'product_id' => $i->product_id,
                    'variant_id' => $i->variant_id,
                    'product_unit_id' => $i->product_unit_id,
                    'quantity' => (float) $i->quantity,
                    'unit_price' => (float) $i->unit_price,
                    'line_discount' => (float) $i->line_discount,
                    'line_total' => (float) $i->line_total,
                    'modifiers' => $i->modifiers ?? [],
                ], fn ($v) => $v !== null))->all(),
                'discount' => $data['discount'] ?? 0,
                'coupon_code' => $data['coupon_code'] ?? null,
                'payments' => $data['payments'] ?? [],
                'payment_method' => $data['payment_method'] ?? null,
                'amount_paid' => $data['amount_paid'] ?? 0,
                'notes' => $data['notes'] ?? "Dine-in tab {$ticket->ticket_number}",
                'trusted_prices' => true,
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

    /**
     * Resolve a split-by-quantity request into the ticket-item rows this sale
     * will ring. A line settled for its full remaining quantity is returned
     * whole; a line settled for LESS is divided — a new row holding the paid
     * portion (returned) and the original left holding the unpaid remainder.
     *
     * @param  array<array{id: string, quantity: float|int|string}>  $splits
     * @return Collection<int, RestaurantTicketItem>
     */
    private function resolveSplits(RestaurantTicket $ticket, array $splits): Collection
    {
        // A line may appear more than once in the payload — sum the requested
        // quantity per line so the cap check sees the true total.
        $wanted = [];
        foreach ($splits as $s) {
            $id = (string) $s['id'];
            $wanted[$id] = ($wanted[$id] ?? 0.0) + (float) $s['quantity'];
        }

        $settled = collect();
        foreach ($wanted as $id => $qty) {
            /** @var RestaurantTicketItem|null $item */
            $item = $ticket->items()
                ->whereKey($id)
                ->whereNull('voided_at')
                ->whereNull('sale_id')
                ->lockForUpdate()
                ->first();

            if ($item === null) {
                throw DomainException::unprocessable(
                    'An item is already paid, voided, or not on this tab.',
                    'SPLIT_ITEM_INVALID',
                );
            }

            $available = round((float) $item->quantity, 3);
            $qty = round($qty, 3);
            if ($qty > $available + 0.0001) {
                throw DomainException::unprocessable(
                    "Can't settle {$qty} of \"{$item->product_name}\" — only {$available} left unpaid.",
                    'SPLIT_QTY_EXCEEDED',
                );
            }

            $settled->push(
                abs($qty - $available) < 0.0001
                    ? $item                          // whole remaining line
                    : $this->splitRow($item, $qty),  // partial → carve off a paid row
            );
        }

        return $settled;
    }

    /**
     * Carve a paid portion of `$qty` off a ticket line. Money is prorated by
     * the quantity ratio and the remainder is the exact leftover, so the paid
     * row + the leftover always sum back to the original to the paisa. Returns
     * the new paid row (the caller rings it); the original stays open with the
     * remainder.
     */
    private function splitRow(RestaurantTicketItem $item, float $qty): RestaurantTicketItem
    {
        $wholeQty = (float) $item->quantity;
        $wholeTotal = (float) $item->line_total;
        $wholeDiscount = (float) $item->line_discount;

        $paidTotal = round($wholeTotal * $qty / $wholeQty, 2);
        $paidDiscount = round($wholeDiscount * $qty / $wholeQty, 2);

        // Clone the paid portion (same product/variant/unit/modifiers snapshot),
        // minus the identity/settlement fields — HasUuids mints a fresh id on save.
        $paid = $item->replicate(['sale_id', 'created_at', 'updated_at']);
        $paid->quantity = $qty;
        $paid->line_total = $paidTotal;
        $paid->line_discount = $paidDiscount;
        $paid->save();

        // The original keeps the exact remainder and stays unpaid.
        $item->forceFill([
            'quantity' => round($wholeQty - $qty, 3),
            'line_total' => round($wholeTotal - $paidTotal, 2),
            'line_discount' => round($wholeDiscount - $paidDiscount, 2),
        ])->save();

        return $paid;
    }
}
