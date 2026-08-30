<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Support\Payable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Supplier extends BaseModel
{
    use BelongsToTenant;

    protected $appends = ['outstanding', 'advance'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function purchaseOrders(): HasMany
    {
        return $this->hasMany(PurchaseOrder::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(SupplierPayment::class);
    }

    /**
     * Adds the two halves of the account: what was ordered, and what was paid.
     *
     * WHICH ORDERS COUNT is Payable's answer, not this model's — the same one
     * the dashboard uses. A draft is a shopping list, not a bill.
     *
     * PAID is every payment to this supplier, NOT the sum of amount_paid on
     * the orders. The difference is the money that has not landed on an order
     * yet: a van arrives, cash changes hands, and nobody raises a PO. Reading
     * amount_paid made that money invisible and the shop looked like it still
     * owed it.
     */
    public function scopeWithOutstanding(Builder $query): Builder
    {
        return $query
            ->withSum(['purchaseOrders as po_total' => fn ($q) => Payable::billable($q)], 'total')
            ->withSum('payments as paid_total', 'amount');
    }

    /**
     * The account balance, SIGNED.
     *
     * Positive is owed to the supplier. Negative is money paid ahead of any
     * order — an advance, which the shop is owed back in goods. Both are real
     * states of a small-shop account and collapsing the second to zero is how
     * a Rs 3,500 cash-on-delivery payment used to disappear.
     */
    protected function outstanding(): Attribute
    {
        return Attribute::get(fn (): float => round(
            (float) ($this->attributes['po_total'] ?? 0) - (float) ($this->attributes['paid_total'] ?? 0),
            2,
        ));
    }

    /** Money paid ahead of any order, as a positive number (0 when none). */
    protected function advance(): Attribute
    {
        return Attribute::get(fn (): float => round(max(0.0, -$this->outstanding), 2));
    }
}
