<?php

namespace App\Models;

use App\Enums\RestaurantTicketStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * A physical table on the restaurant floor. Occupancy is DERIVED from the
 * presence of an open ticket — there is no status column to fall out of sync.
 */
class DiningTable extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'seats' => 'integer',
            'sort_order' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    public function tickets(): HasMany
    {
        return $this->hasMany(RestaurantTicket::class, 'dining_table_id');
    }

    /** The current running tab on this table, if any. */
    public function openTicket(): HasOne
    {
        return $this->hasOne(RestaurantTicket::class, 'dining_table_id')
            ->where('status', RestaurantTicketStatus::Open->value)
            ->latest('opened_at');
    }

    public function isOccupied(): bool
    {
        return $this->openTicket()->exists();
    }
}
