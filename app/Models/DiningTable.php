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
    /**
     * A floor row always belongs to a site.
     *
     * Defaulted here rather than at each call site because the floor is written
     * from several — the tables controller, OpenTicketAction, FireKitchenTicket,
     * a seeder, a test fixture — and a row that slips through with no branch is
     * invisible on every branch-scoped screen, which is a worse failure than
     * being on the wrong one. Anything that DOES know its branch (a tab takes
     * its table's, a KOT takes its tab's) sets it before this runs and is left
     * alone.
     */
    protected static function booted(): void
    {
        static::creating(function (self $row): void {
            if ($row->branch_id !== null || $row->tenant_id === null) {
                return;
            }

            $row->branch_id = Branch::withoutTenancy()
                ->where('tenant_id', $row->tenant_id)
                ->where('is_default', true)
                ->value('id');
        });
    }

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
