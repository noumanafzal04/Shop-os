<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Support\BranchContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A physical location under a tenant. Every tenant has exactly one is_default
 * "Main" branch; multi-branch tenants add more. Branch-scoped data (stock,
 * sales, cash, expenses) references a branch in later phases.
 */
class Branch extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'is_default' => 'boolean',
            'is_active' => 'boolean',
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
        ];
    }

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class);
    }

    /**
     * The branch a write belongs to when the client named none.
     *
     * A single-site shop never sends a branch, and the honest answer for it is
     * "the only one there is" — not null. Null is not a branch; it is a row
     * that no branch-scoped query will ever match again.
     *
     * This exists because two halves of the forecourt resolved the same
     * question in opposite directions and never met. Opening a shift read a
     * missing branch as Main; adding a tank stored it as null. Exactly one of
     * those can be right, and the result was that every station which set up
     * its forecourt through the panel — which sends no branch_id — was told
     * "set up at least one tank and one nozzle" for ever, having just done so.
     *
     * One resolver, called from both sides, so they cannot disagree again.
     * Prefers the branch actually being operated; falls back to the tenant's
     * default.
     */
    public static function writeTargetId(): ?string
    {
        $operating = app(BranchContext::class)->id();

        return $operating ?? static::query()->where('is_default', true)->value('id');
    }
}
