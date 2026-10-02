<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Capacity granted to one shop on top of what its plan gives.
 *
 * An ADD-ON is one of these with a price. A TEMPORARY GRANT is one with an
 * end date. A concession is one with neither. See the migration for why they
 * are one table.
 */
class TenantEntitlement extends BaseModel
{
    use Auditable, BelongsToTenant, SoftDeletes;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'quantity' => 'integer',
            'unit_price' => 'decimal:2',
            'starts_on' => 'date',
            'ends_on' => 'date',
        ];
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /**
     * IN FORCE TODAY — the only question a ceiling ever asks of this table.
     *
     * Dates, not timestamps. A grant that runs "until 31 December" is in
     * force for the whole of the 31st, which is what somebody who typed that
     * date meant; comparing against `now()` would end it at midnight on the
     * 30th and take three staff accounts away a day early.
     *
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeLive(Builder $query, ?string $on = null): Builder
    {
        $day = $on ?? now()->toDateString();

        return $query
            ->whereDate('starts_on', '<=', $day)
            ->where(fn (Builder $q) => $q->whereNull('ends_on')->orWhereDate('ends_on', '>=', $day));
    }

    /** Granted, but its window has passed. Kept, and shown as history. */
    public function hasExpired(): bool
    {
        return $this->ends_on !== null && $this->ends_on->isBefore(now()->startOfDay());
    }

    /** Granted for a window that has not opened yet. */
    public function isPending(): bool
    {
        return $this->starts_on->isAfter(now()->endOfDay());
    }

    /**
     * What this line is worth per billing period, or null when no price was
     * ever set. Null is not zero: zero is "agreed free", null is "nobody
     * said", and an invoice run has to tell them apart.
     */
    public function periodValue(): ?float
    {
        return $this->unit_price === null ? null : round((float) $this->unit_price * $this->quantity, 2);
    }
}
