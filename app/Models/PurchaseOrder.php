<?php

namespace App\Models;

use App\Enums\PurchaseStatus;
use App\Models\Concerns\BelongsToTenant;
use App\Models\Concerns\HidesSupplierMoney;
use App\Support\Payable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PurchaseOrder extends BaseModel
{
    use BelongsToTenant, HidesSupplierMoney;

    protected function casts(): array
    {
        return [
            'status' => PurchaseStatus::class,
            // Calendar days, sent as the day they are ("2026-10-13"). As plain
            // `date` they went out as midnight UTC and were printed raw on the
            // order list — and read as a moment, would be the day before
            // anywhere west of Greenwich.
            'order_date' => 'date:Y-m-d',
            'expected_date' => 'date:Y-m-d',
            'received_at' => 'datetime',
            'subtotal' => 'decimal:2',
            'discount' => 'decimal:2',
            'tax' => 'decimal:2',
            'total' => 'decimal:2',
            'amount_paid' => 'decimal:2',
        ];
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(PurchaseOrderItem::class);
    }

    /**
     * Where the supplier is to bring it — a branch, or the warehouse. Null on
     * an order raised before orders were addressed: it goes wherever it is
     * received, as it always did.
     */
    public function deliverTo(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'deliver_to_branch_id');
    }

    public function payments(): HasMany
    {
        return $this->hasMany(SupplierPayment::class);
    }

    /**
     * Every payment that paid part of this order, and how much of it — the
     * order's own history. `payments` above holds only those that named this
     * order alone; one on account spread over several names none.
     */
    public function allocations(): HasMany
    {
        return $this->hasMany(SupplierPaymentAllocation::class);
    }

    /**
     * Settled or not — measured against the DELIVERY.
     *
     * This compared `amount_paid` to `total`, so an order that arrived short
     * and was paid in full for what arrived read "partial" for ever. The shop
     * is then chasing a balance it does not owe, and the commonest way that
     * ends is paying it.
     *
     * Nothing delivered yet is "unpaid" whatever has been handed over: there
     * is no bill to settle, and money paid ahead shows as an advance on the
     * supplier's account, which is where it belongs.
     */
    public function syncPaymentStatus(): void
    {
        $paid = (float) $this->amount_paid;
        $billed = (float) $this->{Payable::AMOUNT};

        $this->payment_status = match (true) {
            $billed <= 0 => 'unpaid',
            $paid <= 0 => 'unpaid',
            $paid + 0.001 >= $billed => 'paid',
            default => 'partial',
        };
    }

    /**
     * The order's money — kept from whoever only takes the delivery in. Its
     * lines, quantities and their cost stay (HidesCostPrice decides those).
     *
     * @return list<string>
     */
    protected function supplierMoneyKeys(): array
    {
        return ['subtotal', 'discount', 'tax', 'total', 'amount_paid', 'received_total', 'payment_status', 'payments', 'allocations'];
    }
}
