<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The shop counted the cash and took it. See the migration for why nothing
 * else about a rider's money is stored.
 */
class RiderSettlement extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'cash_collected' => 'decimal:2',
            'rider_earned' => 'decimal:2',
            'amount_paid' => 'decimal:2',
            'orders_count' => 'integer',
            'settled_at' => 'datetime',
        ];
    }

    public function riderProfile(): BelongsTo
    {
        return $this->belongsTo(RiderProfile::class);
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(Rider::class);
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }
}
