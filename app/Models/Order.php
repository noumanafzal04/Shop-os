<?php

namespace App\Models;

use App\Enums\FulfillmentType;
use App\Enums\OrderStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Order extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'status' => OrderStatus::class,
            'fulfillment_type' => FulfillmentType::class,
            'subtotal' => 'decimal:2',
            'discount' => 'decimal:2',
            'delivery_fee' => 'decimal:2',
            'total' => 'decimal:2',
            'placed_at' => 'datetime',
            'rider_assigned_at' => 'datetime',
            'rider_accepted_at' => 'datetime',
            'rider_self_claimed' => 'boolean',
            // The staged offer. `offered_at` is READ as a date — `widestReached`
            // asks it for `diffInSeconds`, and an uncast column is a string
            // that answers by fataling. The radius is a decimal that is
            // compared against kilometres, so it stays a float rather than the
            // 'decimal:1' string every other money column uses.
            'offer_radius_km' => 'float',
            'offered_at' => 'datetime',
            'picked_up_at' => 'datetime',
            'delivered_at' => 'datetime',
        ];
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(Rider::class);
    }

    /**
     * WHOSE IS THE DELIVERY FEE? (#ON1 — the owner's rule, 2026-10-30)
     *
     * "Depends whether the rider is the system's or the shop's own." A rider
     * the platform sent — who took the job from the pool — keeps the fee: it
     * is their pay, and they hand in the goods money only. A shop's own rider
     * (assigned by the shop, or nobody at all) carries it for the shop, and
     * the fee is the shop's income, booked when the order completes.
     */
    public function riderKeepsTheFee(): bool
    {
        return $this->rider_self_claimed === true;
    }

    /** The part of the delivery fee that is the rider's, not the shop's. */
    public function feeToTheRider(): float
    {
        return $this->riderKeepsTheFee() ? round((float) $this->delivery_fee, 2) : 0.0;
    }

    public function riderSettlement(): BelongsTo
    {
        return $this->belongsTo(RiderSettlement::class);
    }

    /**
     * The branch that filled it — null for orders placed before shops tracked
     * this, which genuinely came out of the default one and cannot honestly be
     * relabelled now.
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }
}
