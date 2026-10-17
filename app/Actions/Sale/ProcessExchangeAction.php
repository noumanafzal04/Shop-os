<?php

namespace App\Actions\Sale;

use App\Models\Sale;
use App\Models\SaleReturn;
use Illuminate\Support\Facades\DB;

/**
 * Exchange = {return old items} + {sell replacements} in ONE atomic step.
 *
 * The returned items are credited (NOT paid out in cash) toward the new sale;
 * the customer settles any positive difference with their own tenders. This
 * reuses the audited return + sale write-paths, so stock, pricing, batches and
 * invoicing all stay correct. Cash reconciliation is automatic:
 *   - upgrade  (new > credit): customer's cash difference lands in the drawer
 *   - even     (new = credit): no cash moves
 *   - downgrade (new < credit): change_due refunds the difference in cash,
 *     out of the exchanging person's own drawer
 * If the customer under-pays the difference, CreateSaleAction throws
 * PAYMENT_INSUFFICIENT and the whole exchange rolls back.
 */
class ProcessExchangeAction
{
    public function __construct(
        private readonly ProcessSaleReturnAction $returns,
        private readonly CreateSaleAction $sales,
    ) {}

    /**
     * @param array{
     *   return_items: array<array{sale_item_id: string, quantity: float}>,
     *   items: array<array<string, mixed>>,
     *   payments?: array<array{method: string, amount: float, reference?: ?string}>,
     *   channel?: ?string, cash_session_id?: ?string, reason?: ?string
     * } $data
     * @return array{return: SaleReturn, sale: Sale, difference: float}
     */
    public function execute(Sale $sale, array $data): array
    {
        return DB::transaction(function () use ($sale, $data): array {
            // 1. Take the old items back as an EXCHANGE CREDIT (refund_method
            //    'other' = not a cash payout — it funds the new sale below).
            $return = $this->returns->execute($sale, [
                'items' => $data['return_items'],
                'reason' => $data['reason'] ?? 'Exchange',
                'refund_method' => 'other',
                'cash_session_id' => $data['cash_session_id'] ?? null,
                'approved_by' => $data['approved_by'] ?? null,
                'notes' => "Exchange against {$sale->invoice_number}",
                // A khata sale's debt must survive the exchange: the returned
                // value funds the replacement below, so reversing the charge
                // here too would double-benefit the customer.
                'skip_credit_reversal' => true,
            ]);
            $credit = round((float) $return->refund_total, 2);

            // 2. New sale for the replacements. The credit is the first tender;
            //    the customer's own tenders cover any positive difference.
            $tenders = [[
                'method' => 'other',
                'amount' => $credit,
                'reference' => "Exchange credit — return {$return->return_number}",
            ]];
            foreach ($data['payments'] ?? [] as $payment) {
                $tenders[] = $payment;
            }

            $newSale = $this->sales->execute([
                'channel' => $data['channel'] ?? 'pos',
                'cash_session_id' => $data['cash_session_id'] ?? null,
                'items' => $data['items'],
                'payments' => $tenders,
                'notes' => "Exchange for {$sale->invoice_number}",
                // THE SAME CUSTOMER (B10). The replacement was a sale to
                // nobody: the return took the shirt's points back, the new
                // shirt earned none, and the customer's history stopped at the
                // goods they brought back. Their price group and their khata
                // follow them too, as on any sale to them.
                'customer_name' => $sale->customer_name ?? $sale->customer?->name,
                'customer_phone' => $sale->customer_phone ?? $sale->customer?->phone,
                // The credit may come back as change on a downgrade (see the
                // top of this file). Said here, server-side only: a request to
                // /sales cannot carry it — StoreSaleRequest does not declare it.
                'exchange_credit' => $credit,
            ]);

            // WHAT THE CREDIT PAID FOR, kept on both halves (B21). Taken off
            // the refunds and off the takings alike, so the day reads as the
            // difference that changed hands, not as a refund and a new sale.
            // The rest of a credit bigger than the replacement went back over
            // the counter, and stays a refund.
            $used = round(min($credit, (float) $newSale->total), 2);
            DB::table('sale_returns')->where('id', $return->id)->update(['exchange_credit' => $used]);
            DB::table('sales')->where('id', $newSale->id)->update(['exchange_credit' => $used]);
            $return->setAttribute('exchange_credit', $used);
            $newSale->setAttribute('exchange_credit', $used);

            return [
                'return' => $return->load('items'),
                'sale' => $newSale,
                'difference' => round((float) $newSale->total - $credit, 2),
            ];
        });
    }
}
