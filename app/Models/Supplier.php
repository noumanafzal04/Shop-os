<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Supplier extends BaseModel
{
    use BelongsToTenant;

    protected $appends = ['outstanding'];

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

    /** Adds po_total / po_paid sums over non-cancelled orders. */
    public function scopeWithOutstanding(Builder $query): Builder
    {
        return $query
            ->withSum(['purchaseOrders as po_total' => fn ($q) => $q->where('status', '!=', 'cancelled')], 'total')
            ->withSum(['purchaseOrders as po_paid' => fn ($q) => $q->where('status', '!=', 'cancelled')], 'amount_paid');
    }

    /** Amount still owed to this supplier (payable). */
    protected function outstanding(): Attribute
    {
        return Attribute::get(fn (): float => round(
            (float) ($this->attributes['po_total'] ?? 0) - (float) ($this->attributes['po_paid'] ?? 0),
            2,
        ));
    }
}
