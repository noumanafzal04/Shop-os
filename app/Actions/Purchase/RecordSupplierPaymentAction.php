<?php

namespace App\Actions\Purchase;

use App\Actions\Pos\RecordCashMovementAction;
use App\Enums\PurchaseStatus;
use App\Exceptions\DomainException;
use App\Models\PurchaseOrder;
use App\Models\Supplier;
use App\Models\SupplierPayment;
use App\Support\BranchContext;
use App\Support\Payable;
use App\Support\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Records a payment to a supplier and applies it to what is owed.
 *
 * Two ways in, and for a long time only one of them worked:
 *
 *  - AGAINST ONE ORDER (`purchase_order_id`) — that order's amount_paid and
 *    payment_status are recomputed. Every test we had used this door.
 *  - ON ACCOUNT (amount only) — which is the door the Suppliers screen uses,
 *    and the only one a shopkeeper meets. It filed the payment, took the cash
 *    out of the drawer, and applied it to NOTHING: the row still showed the
 *    full amount owed, so the natural next move was to pay again.
 *
 * An on-account payment now settles the supplier's placed orders OLDEST FIRST
 * — the order a shop and a wholesaler both keep the account in. Anything left
 * over stays unallocated and shows on the supplier as an ADVANCE. That is not
 * a loophole: a wholesaler's van arrives, cash changes hands, and nobody
 * raises a purchase order. Refusing that would refuse the commonest payment a
 * small shop makes.
 *
 * A payment aimed at ONE order is still held to that order's due, because the
 * caller named a figure that can be checked. And no order can be paid before
 * it is placed — you cannot settle a basket somebody is still filling.
 */
class RecordSupplierPaymentAction
{
    /**
     * @param  array{amount: float, method?: string, reference?: ?string, paid_at?: ?string, notes?: ?string, purchase_order_id?: ?string}  $data
     */
    public function execute(Supplier $supplier, array $data): SupplierPayment
    {
        return DB::transaction(function () use ($supplier, $data): SupplierPayment {
            $amount = round((float) $data['amount'], 2);

            /** @var Collection<int, PurchaseOrder> $targets */
            $targets = ! empty($data['purchase_order_id'])
                ? collect([$this->namedOrder($supplier, (string) $data['purchase_order_id'])])
                : Payable::openOrdersFor($supplier->id)->lockForUpdate()->get();

            if (! empty($data['purchase_order_id'])) {
                $this->refuseOverpayment($targets->first(), $amount);
            }

            $applied = $this->applyOldestFirst($targets, $amount);

            /** @var SupplierPayment $payment */
            $payment = SupplierPayment::query()->create([
                'tenant_id' => $supplier->tenant_id,
                // Which till the money left. A payment is money OUT and the
                // books scope by branch, so it needs the OPERATING branch —
                // null on headless paths, which reads as "unattributed" rather
                // than being guessed onto Main.
                'branch_id' => app(BranchContext::class)->id(),
                'supplier_id' => $supplier->id,
                // Named when the whole amount landed on ONE order — the common
                // case, and the supplier's history is worth more when it says
                // which order was settled. Null when it spanned several, which
                // is what an on-account payment genuinely is; the orders
                // themselves carry the allocation.
                'purchase_order_id' => count($applied) === 1 ? array_key_first($applied) : null,
                'amount' => $amount,
                'method' => $data['method'] ?? 'cash',
                'reference' => $data['reference'] ?? null,
                'paid_at' => $data['paid_at'] ?? now(),
                'notes' => $data['notes'] ?? null,
                'created_by' => auth()->id(),
            ]);

            // Paying a supplier from the till takes cash OUT of the drawer. It
            // was invisible to reconciliation before, so a Rs 3,500 delivery
            // paid in cash read as a Rs 3,500 shortage against the cashier.
            // ONE movement for one payment, however many orders it settled.
            $actor = auth()->user();
            if ($actor !== null && ($payment->method === 'cash')) {
                app(RecordCashMovementAction::class)->record($actor, [
                    'type' => 'supplier_out',
                    'amount' => (float) $payment->amount,
                    'reason' => 'Supplier paid · '.$supplier->name,
                    'source_type' => 'supplier_payment',
                    'source_id' => $payment->id,
                ]);
            }

            return $payment;
        });
    }

    /** The one order the caller named — locked, and proven to be this supplier's. */
    private function namedOrder(Supplier $supplier, string $id): PurchaseOrder
    {
        /** @var PurchaseOrder $po */
        $po = PurchaseOrder::query()
            ->where('supplier_id', $supplier->id)
            ->lockForUpdate()
            ->findOrFail($id);

        // A draft is not yet an order and a cancelled one is not one any more.
        // Paying either would subtract money from a debt that is not on the
        // books, and the supplier's balance would go quietly wrong.
        // `status` is cast to PurchaseStatus, so this compares enum cases. The
        // string version of this check silently matched nothing.
        if (in_array($po->status, [PurchaseStatus::Draft, PurchaseStatus::Cancelled], true)) {
            throw DomainException::unprocessable(
                $po->status === PurchaseStatus::Draft
                    ? 'Place this order before paying against it.'
                    : 'This order was cancelled — pay on account instead.',
                'PO_NOT_PAYABLE',
            );
        }

        return $po;
    }

    private function refuseOverpayment(PurchaseOrder $po, float $amount): void
    {
        $due = round((float) $po->total - (float) $po->amount_paid, 2);

        if ($amount - 0.001 <= $due) {
            return;
        }

        $sym = app(TenantContext::class)->get()?->currencySymbol() ?? 'Rs';

        throw DomainException::unprocessable(
            "Payment exceeds the amount due on this purchase order ({$sym} ".number_format($due, 2).').',
            'PAYMENT_EXCEEDS_DUE',
        );
    }

    /**
     * @param  Collection<int, PurchaseOrder>  $targets
     * @return array<string, float> order id => amount applied
     */
    private function applyOldestFirst(Collection $targets, float $amount): array
    {
        $left = $amount;
        $applied = [];

        foreach ($targets as $po) {
            if ($left <= 0.001) {
                break;
            }

            $due = round((float) $po->total - (float) $po->amount_paid, 2);
            if ($due <= 0) {
                continue;
            }

            $take = min($left, $due);
            $po->amount_paid = round((float) $po->amount_paid + $take, 2);
            $po->syncPaymentStatus();
            $po->save();

            $applied[$po->id] = $take;
            $left = round($left - $take, 2);
        }

        return $applied;
    }
}
