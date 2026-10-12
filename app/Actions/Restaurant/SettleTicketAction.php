<?php

namespace App\Actions\Restaurant;

use App\Actions\Sale\CreateSaleAction;
use App\Enums\RestaurantTicketStatus;
use App\Exceptions\DomainException;
use App\Exceptions\SaleQuoted;
use App\Models\RestaurantTicket;
use App\Models\RestaurantTicketItem;
use App\Models\Sale;
use App\Support\DiscountCeiling;
use App\Support\TenantContext;
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
    public function __construct(
        private readonly CreateSaleAction $createSale,
        private readonly TenantContext $context,
    ) {}

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

            // THE CEILING, before the trusted path takes the numbers on faith.
            //
            // The sale below is rung with `trusted_prices`, deliberately: the
            // tab's captured snapshot IS the bill and live menu state must not
            // reprice food already eaten. The counter's own ceiling check sits
            // on the untrusted branch, so it does not run here — which left a
            // whole-tab discount at settlement uncapped for anybody holding
            // `discounts.apply`. Checked here, against the same bill the sale
            // is about to be built from.
            $settling = round(
                $items->sum(fn ($i) => round((float) $i->unit_price * (float) $i->quantity, 2)),
                2,
            );
            $given = round($settling - (float) $items->sum('line_total') + (float) ($data['discount'] ?? 0), 2);

            DiscountCeiling::assert($this->context, $given, $settling);

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
                // The tip goes on the settlement, not on the tab: a split bill
                // can carry a tip on one share and not another.
                'tip_amount' => $data['tip_amount'] ?? 0,
                'notes' => $data['notes'] ?? "Dine-in tab {$ticket->ticket_number}",
                'trusted_prices' => true,
                // This bill is a TAB's: the kitchen has had every line of it
                // already. See CreateSaleAction — a sale is otherwise sent to
                // the pass whether it was rung to take away or for here.
                'settles_tab' => true,
                // Asked about, not settled — see worth().
                'quote_only' => ! empty($data['quote_only']),
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
     * WHAT THIS PART OF THE TAB WILL COME TO — asked of the path that charges it.
     *
     *     "Take Rs 4,485" — and the till refused it: "Amount paid (4,485.00)
     *      is less than the total (4,611.90)."
     *
     * The settle sheet added the bill up itself, at the shop's default rate.
     * A table with tea at its own 18% owed more than the sheet said, the sheet
     * sent its own figure as the cash handed over, and the tab could not be
     * settled from the screen at all. (An over-estimate was called "safe" in
     * the screen's own comment. An under-estimate is a refusal.)
     *
     * The printed bill was fixed by writing the sale's rule out again
     * (TabBill). A second copy of a rule is one more thing to drift, and this
     * figure has more in it than the bill has: a part of a line, a tip, the
     * coin a cash bill settles to. So this does not compute anything. It runs
     * the settlement itself with `quote_only`, the sale path stops at the
     * moment it knows what is due, and the transaction is rolled back — the
     * line it carved in two for a split is whole again, and no number was
     * taken.
     *
     * @return array<string, float>
     */
    public function worth(RestaurantTicket $ticket, array $data): array
    {
        try {
            $this->execute($ticket, ['quote_only' => true, 'amount_paid' => 0] + $data);
        } catch (SaleQuoted $asked) {
            return $asked->figures;
        }

        // The sale path stops before it writes when it is only asked. If it
        // ever does not, a tab has just been settled by a question.
        throw new \LogicException('A tab was settled while it was only being asked about.');
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
