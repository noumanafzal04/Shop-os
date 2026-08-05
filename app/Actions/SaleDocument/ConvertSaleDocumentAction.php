<?php

namespace App\Actions\SaleDocument;

use App\Actions\Sale\CreateSaleAction;
use App\Enums\PaymentMethod;
use App\Enums\SaleChannel;
use App\Exceptions\DomainException;
use App\Models\Sale;
use App\Models\SaleDocument;
use Illuminate\Support\Facades\DB;

/**
 * The moment a promise becomes revenue: the customer is at the counter, the
 * goods are going out of the door, and a real Sale is rung for the full amount.
 *
 * ── Why the deposit is tendered rather than deducted ────────────────────
 *
 * The sale is for the WHOLE total — Rs 90,000 of goods left the shop and the
 * shop's takings should say so. What differs is where the money came from: an
 * advance paid six weeks ago is settled as its own tender (`deposit`), and the
 * balance is tendered normally at the till. So the drawer counted tonight
 * expects only the balance, the revenue reported for today is the full sale,
 * and neither number is inflated by the other. Deducting the deposit from the
 * total instead would understate the sale, misprice the tax, and print a
 * receipt that doesn't match what the customer bought.
 *
 * ── Why the price is replayed, not recalculated ─────────────────────────
 *
 * The whole point of both documents is a price the customer can rely on. So
 * conversion goes down CreateSaleAction's trusted path, carrying the frozen
 * line totals and settled tax. A quotation that has LAPSED is the one case
 * where that hold has run out — the shop offered thirty days, not forever —
 * and it is refused rather than silently re-priced, because a cashier being
 * told "this quote expired" can go and ask, while a cashier handed a quietly
 * different total finds out when the customer does.
 *
 * A layaway past its collect-by date is NOT refused. The customer's money is
 * already in the shop's till; refusing to hand over goods they have paid for
 * because a date passed is not a policy, it's a dispute.
 */
class ConvertSaleDocumentAction
{
    public function __construct(private readonly CreateSaleAction $createSale) {}

    /**
     * @param  array{payments?: array<int, array{method: string, amount: float|int|string, reference?: ?string}>,
     *   payment_method?: string, amount_paid?: float|int|string, cash_session_id?: ?string,
     *   notes?: ?string, prescription_number?: ?string, idempotency_key?: ?string}  $data
     */
    public function execute(SaleDocument $document, array $data = []): Sale
    {
        return DB::transaction(function () use ($document, $data): Sale {
            /** @var SaleDocument $doc */
            $doc = SaleDocument::query()
                ->with('items')
                ->whereKey($document->id)
                ->lockForUpdate()
                ->firstOrFail();

            if (! $doc->isOpen()) {
                throw DomainException::conflict(
                    $doc->status === SaleDocument::STATUS_CONVERTED
                        ? "{$doc->number} has already been billed."
                        : "{$doc->number} was cancelled.",
                    'DOCUMENT_NOT_OPEN',
                );
            }

            if ($doc->isQuotation() && $doc->hasLapsed()) {
                throw DomainException::unprocessable(
                    "This quotation expired on {$doc->expires_at->toFormattedDateString()}. Re-quote it at today's prices.",
                    'QUOTATION_EXPIRED',
                );
            }

            if ($doc->items->isEmpty()) {
                throw DomainException::unprocessable('This document has no items.', 'DOCUMENT_EMPTY');
            }

            // ── Tenders ─────────────────────────────────────────────
            // Money already received rides in as its own method so today's
            // drawer never sees it; the balance is whatever the cashier takes
            // now. A layaway settled in full beforehand converts with the
            // deposit tender alone and no cash at all.
            $deposit = round((float) $doc->deposit_paid, 2);
            $tenders = [];

            if ($deposit > 0) {
                $tenders[] = [
                    'method' => PaymentMethod::Deposit->value,
                    'amount' => $deposit,
                    'reference' => $doc->number,
                ];
            }

            foreach ($data['payments'] ?? [] as $tender) {
                $amount = round((float) $tender['amount'], 2);
                if ($amount <= 0) {
                    continue;
                }
                $tenders[] = [
                    'method' => $tender['method'],
                    'amount' => $amount,
                    'reference' => $tender['reference'] ?? null,
                ];
            }

            // Single-tender shorthand from the till ("cash, 15000").
            if (! empty($data['payment_method']) && ! empty($data['amount_paid'])) {
                $tenders[] = [
                    'method' => $data['payment_method'],
                    'amount' => round((float) $data['amount_paid'], 2),
                    'reference' => null,
                ];
            }

            if ($tenders === []) {
                throw DomainException::unprocessable(
                    'Take the balance before handing the goods over.',
                    'PAYMENT_REQUIRED',
                );
            }

            $sale = $this->createSale->execute([
                'channel' => SaleChannel::Pos->value,
                'items' => $doc->items->map(fn ($item) => [
                    'product_id' => $item->product_id,
                    'variant_id' => $item->variant_id,
                    'product_unit_id' => $item->unit_id,
                    'quantity' => (float) $item->quantity,
                    // The frozen numbers — this is the promise being kept.
                    'unit_price' => (float) $item->unit_price,
                    'line_discount' => (float) $item->line_discount,
                    'line_total' => (float) $item->line_total,
                    // Serials are captured HERE, not on the document: you
                    // record the IMEI of the handset you actually hand over,
                    // not one you promised six weeks ago.
                    'serials' => $data['serials'][$item->id] ?? [],
                ])->all(),
                'discount' => (float) $doc->discount,
                'tax' => (float) $doc->tax,
                'tax_inclusive' => (bool) $doc->tax_inclusive,
                'payments' => $tenders,
                'customer_name' => $doc->customer_name,
                'customer_phone' => $doc->customer_phone,
                'cash_session_id' => $data['cash_session_id'] ?? null,
                'notes' => $data['notes'] ?? "From {$doc->number}",
                'idempotency_key' => $data['idempotency_key'] ?? null,
                // Replaying a settled document, not pricing a fresh basket.
                'trusted_prices' => true,
                // A layaway's goods left the shelf when the advance was taken.
                // A quotation reserved nothing, so its stock moves now — and
                // may legitimately fail if the shelf has since emptied.
                'skip_stock' => (bool) $doc->stock_reserved,
            ]);

            $doc->forceFill([
                'status' => SaleDocument::STATUS_CONVERTED,
                'sale_id' => $sale->id,
                'converted_at' => now(),
                // The goods are the customer's now; nothing is being held.
                'stock_reserved' => false,
            ])->save();

            return $sale;
        });
    }
}
