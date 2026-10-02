<?php

namespace App\Models;

use App\Enums\PurchaseStatus;
use App\Models\Concerns\BelongsToTenant;
use App\Support\Payable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PurchaseOrder extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'status' => PurchaseStatus::class,
            'order_date' => 'date',
            'expected_date' => 'date',
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

    public function payments(): HasMany
    {
        return $this->hasMany(SupplierPayment::class);
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
}
