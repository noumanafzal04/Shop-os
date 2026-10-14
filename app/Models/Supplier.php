<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Models\Concerns\HidesSupplierMoney;
use App\Support\Payable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Supplier extends BaseModel
{
    use BelongsToTenant, HidesSupplierMoney;

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
            // What ARRIVED, not what was ordered — see Payable::AMOUNT and
            // the migration that added it. Billing the order meant a shop was
            // shown a debt for goods still in a van.
            ->withSum(['purchaseOrders as po_total' => fn ($q) => Payable::billable($q)], Payable::AMOUNT)
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
        // Null when the two sums were not loaded (withOutstanding()) — a
        // supplier read inside an order said "owes 0" for one owed 29,400
        // (tester pass 2, B46). Unknown is not zero.
        return Attribute::get(fn (): ?float => array_key_exists('po_total', $this->attributes)
            ? round((float) $this->attributes['po_total'] - (float) ($this->attributes['paid_total'] ?? 0), 2)
            : null);
    }

    /** Money paid ahead of any order, as a positive number (0 when none). */
    protected function advance(): Attribute
    {
        return Attribute::get(fn (): ?float => $this->outstanding === null ? null : round(max(0.0, -$this->outstanding), 2));
    }

    /** @return list<string> */
    protected function supplierMoneyKeys(): array
    {
        return ['outstanding', 'advance', 'po_total', 'paid_total', 'payments'];
    }
}
