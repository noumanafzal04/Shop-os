<?php

namespace App\Actions\Purchase;

use App\Actions\Pos\RecordCashMovementAction;
use App\Exceptions\DomainException;
use App\Models\PurchaseOrder;
use App\Models\Supplier;
use App\Models\SupplierPayment;
use Illuminate\Support\Facades\DB;

/**
 * Records a payment to a supplier — optionally against a specific PO, which
 * then has its amount_paid + payment_status recomputed. Over-payment on a
 * single PO is rejected.
 */
class RecordSupplierPaymentAction
{
    /**
     * @param array{amount: float, method?: string, reference?: ?string, paid_at?: ?string, notes?: ?string, purchase_order_id?: ?string} $data
     */
    public function execute(Supplier $supplier, array $data): SupplierPayment
    {
        return DB::transaction(function () use ($supplier, $data): SupplierPayment {
            $po = null;
            if (! empty($data['purchase_order_id'])) {
                /** @var PurchaseOrder $po */
                $po = PurchaseOrder::query()
                    ->where('supplier_id', $supplier->id)
                    ->lockForUpdate()
                    ->findOrFail($data['purchase_order_id']);

                $due = round((float) $po->total - (float) $po->amount_paid, 2);
                if ((float) $data['amount'] - 0.001 > $due) {
                    $sym = app(\App\Support\TenantContext::class)->get()?->currencySymbol() ?? 'Rs';
                    throw DomainException::unprocessable(
                        "Payment exceeds the amount due on this purchase order ({$sym} ".number_format($due, 2).').',
                        'PAYMENT_EXCEEDS_DUE',
                    );
                }
            }

            /** @var SupplierPayment $payment */
            $payment = SupplierPayment::query()->create([
                'tenant_id' => $supplier->tenant_id,
                'supplier_id' => $supplier->id,
                'purchase_order_id' => $po?->id,
                'amount' => round((float) $data['amount'], 2),
                'method' => $data['method'] ?? 'cash',
                'reference' => $data['reference'] ?? null,
                'paid_at' => $data['paid_at'] ?? now(),
                'notes' => $data['notes'] ?? null,
                'created_by' => auth()->id(),
            ]);

            if ($po !== null) {
                $po->amount_paid = round((float) $po->amount_paid + (float) $payment->amount, 2);
                $po->syncPaymentStatus();
                $po->save();
            }

            // Paying a supplier from the till takes cash OUT of the drawer. It
            // was invisible to reconciliation before, so a Rs 3,500 delivery
            // paid in cash read as a Rs 3,500 shortage against the cashier.
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
}
