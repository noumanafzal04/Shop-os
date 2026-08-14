<?php

namespace App\Models;

use App\Enums\PaymentMethod;
use App\Enums\SaleChannel;
use App\Enums\SaleStatus;
use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Sale extends BaseModel
{
    use Auditable, BelongsToTenant;

    /**
     * Practice sales are invisible by default.
     *
     * A new cashier's afternoon on a training till must never reach a revenue
     * figure, a stock count, a tax return or a commission. Filtering it out
     * report by report would work until the next report was written, so the
     * fence is a global scope — the same mechanism this codebase already trusts
     * for tenant isolation, and for the same reason: what must never leak
     * cannot depend on every future query remembering.
     *
     * Opt in with Sale::withTraining() where seeing them is the point: the
     * drawer count of the training shift itself, and reprinting a practice
     * receipt.
     */
    protected static function booted(): void
    {
        static::addGlobalScope('not_training', function ($builder): void {
            $builder->where($builder->qualifyColumn('is_training'), false);
        });
    }

    /** Include practice sales — for the training shift's own reads only. */
    public static function withTraining(): Builder
    {
        return static::query()->withoutGlobalScope('not_training');
    }

    protected function casts(): array
    {
        return [
            'channel' => SaleChannel::class,
            'status' => SaleStatus::class,
            'is_training' => 'boolean',
            'payment_method' => PaymentMethod::class,
            'subtotal' => 'decimal:2',
            'discount' => 'decimal:2',
            'promo_discount' => 'decimal:2',
            'tax' => 'decimal:2',
            'tax_inclusive' => 'boolean',
            'total' => 'decimal:2',
            // Paid on top of the bill. Never part of `total` — see the
            // add_food_service_loop migration.
            'tip_amount' => 'decimal:2',
            'rounding_adjustment' => 'decimal:2',
            'amount_paid' => 'decimal:2',
            'trade_in_total' => 'decimal:2',
            'change_due' => 'decimal:2',
            'points_earned' => 'integer',
            'points_redeemed' => 'integer',
            'sold_at' => 'datetime',
            'cancelled_at' => 'datetime',
            // When it reached us, as against when it happened. A sale rung on
            // Tuesday and synced on Friday is Tuesday's money and Friday's
            // arrival, and neither column can answer the other's question.
            'synced_at' => 'datetime',
            'beyond_offline_window' => 'boolean',
            'after_day_close' => 'boolean',
            // What offline was not allowed to do, that this sale did anyway.
            // Recorded, never corrected — see the migration.
            'offline_violations' => 'array',
        ];
    }

    public function items(): HasMany
    {
        return $this->hasMany(SaleItem::class);
    }

    /** The branch this sale was rung up on (null for legacy/headless sales). */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    /**
     * The lane it was rung on. Null for an online order or a shop that never
     * configured registers — the receipt simply omits the counter line.
     */
    public function register(): BelongsTo
    {
        return $this->belongsTo(Register::class);
    }

    /**
     * The physical till that rang it — set only on a sale that came in offline.
     *
     * A register is a PLACE and this is the THING, and for an offline sale the
     * thing is what matters: the queue lived on that tablet, so "which of my
     * devices did this come from" is the question an owner asks when a day's
     * sales arrive three days late.
     */
    public function device(): BelongsTo
    {
        return $this->belongsTo(PosDevice::class, 'pos_device_id');
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

    /** The vehicle this job was done on — a tyre or auto shop's real key. */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(CustomerVehicle::class, 'vehicle_id');
    }

    /** Goods taken in part-payment on this sale (old battery, worn tyres). */
    public function tradeIns(): HasMany
    {
        return $this->hasMany(SaleTradeIn::class);
    }

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
