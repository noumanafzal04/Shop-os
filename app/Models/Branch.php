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

    /**
     * EXACTLY ONE DEFAULT, AND THE MODEL OWNS IT.
     *
     * The class docblock above has always stated this rule and nothing
     * enforced it. A second row flagged default was accepted in silence — by
     * the API, by a seeder, by anything — and the cost is not untidy data.
     *
     * Two places resolve "the default" the same way:
     *
     *   Branch::writeTargetId()      ->where('is_default', true)->value('id')
     *   InventoryService::adjust()   ->where('is_default', true)->value('id')
     *
     * `value()` takes whichever row the database hands back first. With two
     * defaults, stock is WRITTEN to one branch and READ from the other: the
     * shelf is full, the till says zero, every sale is refused, and nothing
     * anywhere names a branch. Found by building a three-branch shop and
     * watching three hundred sales out of three hundred refuse.
     *
     * It is enforced here rather than in a controller because the callers that
     * broke it were not controllers, and the next one has not been written
     * yet. `saved` rather than `saving`: the new default must already exist
     * before its siblings are stood down, or a failure between the two leaves
     * a shop with none at all.
     */
    protected static function booted(): void
    {
        static::saved(function (self $branch): void {
            if (! $branch->is_default) {
                return;
            }

            static::query()
                ->withoutGlobalScopes()
                // Fenced to the tenant. Without this, opening a branch in one
                // shop would unseat another shop's Main — a worse bug than the
                // one being fixed.
                ->where('tenant_id', $branch->tenant_id)
                ->whereKeyNot($branch->getKey())
                ->where('is_default', true)
                ->update(['is_default' => false]);
        });
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
