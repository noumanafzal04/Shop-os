<?php

namespace App\Models;

use App\Enums\PaymentMethod;
use App\Enums\SaleChannel;
use App\Enums\SaleStatus;
use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Sale extends BaseModel
{
    use Auditable, BelongsToTenant;

    protected function casts(): array
    {
        return [
            'channel' => SaleChannel::class,
            'status' => SaleStatus::class,
            'payment_method' => PaymentMethod::class,
            'subtotal' => 'decimal:2',
            'discount' => 'decimal:2',
            'promo_discount' => 'decimal:2',
            'tax' => 'decimal:2',
            'tax_inclusive' => 'boolean',
            'total' => 'decimal:2',
            'amount_paid' => 'decimal:2',
            'change_due' => 'decimal:2',
            'points_earned' => 'integer',
            'points_redeemed' => 'integer',
            'sold_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    public function items(): HasMany
    {
        return $this->hasMany(SaleItem::class);
    }

    /** The branch this sale was rung up on (null for legacy/headless sales). */
    public function branch(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    /**
     * Why a sale was voided. A fixed list, because the point of recording it is
     * that a manager can COUNT them per cashier — free text can't be tallied.
     */
    public const VOID_REASONS = [
        'wrong_item', 'customer_changed_mind', 'price_error', 'duplicate', 'test_sale', 'other',
    ];

    public const VOID_REASON_LABELS = [
        'wrong_item' => 'Wrong item rung',
        'customer_changed_mind' => 'Customer changed their mind',
        'price_error' => 'Price error',
        'duplicate' => 'Duplicate sale',
        'test_sale' => 'Test sale',
        'other' => 'Other',
    ];

    public function payments(): HasMany
    {
        return $this->hasMany(SalePayment::class);
    }

    public function returns(): HasMany
    {
        return $this->hasMany(SaleReturn::class);
    }

    /** Serialized units (IMEI/serial + warranty) captured on this sale. */
    public function serials(): HasMany
    {
        return $this->hasMany(SaleItemSerial::class);
    }

    public function isCancelled(): bool
    {
        return $this->status === SaleStatus::Cancelled;
    }
}
