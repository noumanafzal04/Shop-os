<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A bank this shop has a card deal with.
 *
 * Per tenant by construction: every shop signs its own arrangements, and a
 * platform-wide bank list would quietly imply that HBL's Ramadan offer is the
 * same for a supermarket in Lahore and a chemist in Quetta. It is not.
 *
 * Soft-deleted and deactivatable rather than removed, because sales already
 * point here and the claim report reads back months.
 */
class Bank extends Model
{
    use BelongsToTenant, HasUuids, SoftDeletes;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function offers(): HasMany
    {
        return $this->hasMany(BankCardOffer::class);
    }

    public function scopeLive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }

    /** What fits on a receipt line. Falls back to the full name. */
    public function shortName(): string
    {
        return $this->short_code ?: $this->name;
    }
}
