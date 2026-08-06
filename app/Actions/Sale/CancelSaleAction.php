<?php

namespace App\Actions\Sale;

use App\Actions\Pos\RecordCashMovementAction;
use App\Enums\SaleStatus;
use App\Exceptions\DomainException;
use App\Models\Customer;
use App\Models\Product;
use App\Models\ProductSerial;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;

/**
 * Cancels a completed sale and restores stock — atomically.
 *
 * Edge cases:
 *  - double cancellation      → 409 SALE_ALREADY_CANCELLED
 *  - restore applied twice    → per-item idempotency keys make the stock
 *                               restore replay-safe even across retries
 *  - product deleted since    → restore skipped for missing products
 *                               (nothing to put stock back onto)
 */
class CancelSaleAction
{
    public function __construct(private readonly InventoryService $inventory) {}

    public function execute(Sale $sale, ?string $reason = null, ?string $reasonCode = null): Sale
    {
        if ($sale->isCancelled()) {
            throw DomainException::conflict('This sale is already cancelled.', 'SALE_ALREADY_CANCELLED');
        }

        // A sale with returns against it can't be voided wholesale: those
        // units (and their money) already went back once, and cancel restores
        // EVERY line — stock and refunds would double. Refund the remaining
        // items through the returns flow instead.
        if ($sale->returns()->exists()) {
            throw DomainException::conflict(
                'This sale has refunds against it — return the remaining items instead of cancelling.',
                'SALE_HAS_RETURNS',
            );
        }

        return DB::transaction(function () use ($sale, $reason, $reasonCode): Sale {
            // Restore stock by REVERSING the exact movements this sale recorded
            // — not by re-reading product recipes. A combo's components can be
            // edited after the sale (SyncComboItemsAction full-replaces them),
            // so the live recipe would restore the wrong items; a pack's factor
            // or a product's tracking could change too. The stock_movements are
            // the ground truth of what was actually decremented. Each 'out'
            // becomes an 'in' of the same amount to the same product/variant.
            // (Cancel is whole-sale only — a sale with returns is refused above
            // — so reversing every 'out' can't collide with a partial return.)
            $outMovements = StockMovement::query()
                ->where('reference_type', 'sale')
                ->where('reference_id', $sale->id)
                ->where('quantity_change', '<', 0)
                ->get();

            foreach ($outMovements as $mv) {
                // Restore only to products that still exist and are still
                // tracked (a since-deleted component has nowhere to go back to).
                $product = Product::query()->whereKey($mv->product_id)->first();
                if ($product === null || ! $product->track_inventory) {
                    continue;
                }

                $this->inventory->adjust([
                    'product_id' => $mv->product_id,
                    'variant_id' => $mv->variant_id,
                    'type' => 'in',
                    'quantity' => abs((float) $mv->quantity_change),
                    'reason' => "Cancelled {$sale->invoice_number}",
                    'reference_type' => 'sale_cancellation',
                    'reference_id' => $sale->id,
                    'idempotency_key' => "cancel-mv-{$mv->id}",
                    // Restore to the exact branch the stock left from.
                    'branch_id' => $mv->branch_id,
                ]);
            }

            // Khata symmetry: cancelling a credit sale wipes whatever of its
            // charge is still un-reversed (a prior partial return may have
            // already reduced it) — the customer owes nothing for a void sale.
            if ($sale->customer_id !== null) {
                $customer = Customer::query()->whereKey($sale->customer_id)->lockForUpdate()->first();
                $outstanding = $customer?->outstandingCreditForSale($sale->id) ?? 0.0;
                if ($customer !== null && $outstanding > 0) {
                    $customer->recordCreditPayment(
                        $outstanding,
                        'cancellation',
                        $sale->invoice_number,
                        "Sale {$sale->invoice_number} cancelled",
                        $sale->id,
                    );
                }
            }

            // Loyalty symmetry: a void reverses the whole sale's loyalty effect
            // — give back every redeemed point and claw back every earned point
            // still standing (clawback is capped to the current balance inside
            // the model, so points already spent aren't forced negative).
            if ($sale->customer_id !== null && ((int) $sale->points_earned > 0 || (int) $sale->points_redeemed > 0)) {
                $loyaltyCustomer = Customer::query()->whereKey($sale->customer_id)->lockForUpdate()->first();
                if ($loyaltyCustomer !== null) {
                    $loyaltyCustomer->reverseEarnedPoints($loyaltyCustomer->loyaltyEarnedReversible($sale->id), $sale->id, "Cancelled {$sale->invoice_number}");
                    $loyaltyCustomer->refundRedeemedPoints($loyaltyCustomer->loyaltyRedeemedReversible($sale->id), $sale->id, "Cancelled {$sale->invoice_number}");
                }
            }

            // Trade-in symmetry: the scrap came in as part of the payment, so
            // voiding the sale sends it back out. Leaving it on the shelf would
            // hand the shop a free dead battery every time a sale was rung and
            // voided — the same shape as the combo and pack restock bugs, and
            // just as invisible in a stock report.
            foreach ($sale->tradeIns()->whereNull('reversed_at')->get() as $tradeIn) {
                if ($tradeIn->product_id !== null) {
                    $this->inventory->adjust([
                        'product_id' => $tradeIn->product_id,
                        'type' => 'out',
                        'quantity' => (float) $tradeIn->quantity,
                        'reason' => "Trade-in returned · voided {$sale->invoice_number}",
                        'reference_type' => 'sale_trade_in_reversal',
                        'reference_id' => $sale->id,
                        // The scrap may already have gone to the dealer. A void
                        // must never be blocked by that — it shows negative for
                        // recount, which is the honest reading.
                        'allow_negative' => true,
                        'branch_id' => $tradeIn->branch_id,
                    ]);
                }
                $tradeIn->forceFill(['reversed_at' => now()])->save();
            }

            // Serial registry: put any serialized units this sale sold back in
            // stock so they can be sold again (mirrors the stock restore above).
            ProductSerial::query()
                ->where('sale_id', $sale->id)
                ->where('status', 'sold')
                ->update(['status' => 'in_stock', 'sale_id' => null]);

            $sale->forceFill([
                'status' => SaleStatus::Cancelled,
                'cancelled_at' => now(),
                'cancelled_by' => auth()->id(),
                'cancel_reason' => $reason,
                'cancel_reason_code' => $reasonCode,
            ])->save();

            // The cash leg. Voiding a cash sale hands money back out of the
            // drawer, and that was recorded NOWHERE: the sale's tender was
            // dropped from the shift's expectation and the pay-out was never
            // written, so a legitimate void and a pocketed one both balanced
            // perfectly. Now the tender stays counted (DrawerMath) and the
            // hand-back is a movement with a name on it, so the two are
            // distinguishable — and a sale voided the day AFTER its shift
            // closed correctly debits today's drawer instead of nobody's.
            $cashTendered = round(
                (float) $sale->payments()->where('method', 'cash')->sum('amount') - (float) $sale->change_due,
                2,
            );
            $actor = auth()->user();
            if ($actor !== null && $cashTendered > 0) {
                app(RecordCashMovementAction::class)->record($actor, [
                    'type' => 'void_refund',
                    'amount' => $cashTendered,
                    'reason' => "Cash returned · voided {$sale->invoice_number}",
                    'note' => $reason,
                    'source_type' => 'sale',
                    'source_id' => $sale->id,
                ]);
            }

            return $sale->load('items');
        });
    }
}
