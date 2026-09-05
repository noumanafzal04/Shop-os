<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A shop's own delivery rider (Model A). Tenant-scoped; assigned to delivery
 * orders. No rider app / GPS — the shop drives the order status by hand.
 */
class Rider extends Model
{
    use BelongsToTenant, HasUuids, SoftDeletes;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }

    /**
     * The person behind the card, when there is one.
     *
     * Null is the normal case and always will be: a shop that hands deliveries
     * to its cousin has nobody to install an app. Set means this card and a
     * `rider_profiles` row are the same human, and the rider sees this shop's
     * jobs on their phone.
     */
    public function riderProfile(): BelongsTo
    {
        return $this->belongsTo(RiderProfile::class);
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }
}
