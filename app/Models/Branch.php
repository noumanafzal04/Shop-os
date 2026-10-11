<?php

namespace App\Models;

use App\Exceptions\DomainException;
use App\Models\Concerns\BelongsToTenant;
use App\Support\BranchContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A physical location under a tenant. Every tenant has exactly one is_default
 * "Main" branch; multi-branch tenants add more. Branch-scoped data (stock,
 * sales, cash, expenses) references a branch in later phases.
 *
 * ── A place is a SHOP or a WAREHOUSE ────────────────────────────────────
 *
 * Both hold stock, and everything that keeps stock per place — the shelf
 * figure, lots, counts, write-offs, transfers — treats them alike. What
 * differs is one thing: **a warehouse does not sell at a counter.** It has no
 * till, no shift, no day to close and no tables. Goods come into it from a
 * supplier and leave it for a shop.
 *
 * It is a kind of branch and not a table of its own because stock is already
 * kept per `branch_id` in a dozen places, and a second kind of location would
 * have had every one of them asking which table a place lives in.
 */
class Branch extends BaseModel
{
    use BelongsToTenant;

    public const KIND_SHOP = 'shop';

    public const KIND_WAREHOUSE = 'warehouse';

    public const KINDS = [self::KIND_SHOP, self::KIND_WAREHOUSE];

    /** A row made before places had a kind — or by a caller that names none — is a shop. */
    protected $attributes = [
        'kind' => self::KIND_SHOP,
    ];

    protected function casts(): array
    {
        return [
            'is_default' => 'boolean',
            'is_active' => 'boolean',
            'fills_orders' => 'boolean',
            'takes_deliveries' => 'boolean',
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
        /**
         * MAIN IS A SHOP, ALWAYS.
         *
         * Every write that names no branch lands on the default one — a sale
         * from a single-site shop, a headless job, a seeder. If that place
         * could be a warehouse, the one branch every shop is guaranteed to
         * have would be the one branch that refuses a sale.
         */
        static::saving(function (self $branch): void {
            if ($branch->is_default && $branch->isWarehouse()) {
                throw DomainException::unprocessable(
                    'The main branch is where the business sells, so it cannot be a warehouse. Add the warehouse as its own place.',
                    'MAIN_IS_A_SHOP',
                );
            }
        });

        /**
         * ONE PLACE WHERE DELIVERIES COME, AT MOST.
         *
         * A business that receives everything into its warehouse marks that
         * warehouse, and every new purchase order starts addressed to it. Two
         * marked places would have an order addressed to whichever the
         * database listed first — the same fault the default branch had.
         * Marking a second one un-marks the first, which is what "the
         * deliveries now come HERE" means.
         */
        static::saved(function (self $branch): void {
            if (! $branch->takes_deliveries) {
                return;
            }

            static::query()
                ->withoutGlobalScopes()
                ->where('tenant_id', $branch->tenant_id)
                ->whereKeyNot($branch->getKey())
                ->where('takes_deliveries', true)
                ->update(['takes_deliveries' => false]);
        });

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

    public function isWarehouse(): bool
    {
        return $this->kind === self::KIND_WAREHOUSE;
    }

    /**
     * Where this business's deliveries come, when it has said — the warehouse
     * of a business that receives everything centrally. Null for one whose
     * suppliers deliver to whichever branch ordered.
     */
    public static function deliveriesComeTo(string $tenantId): ?string
    {
        return static::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->where('takes_deliveries', true)
            ->where('is_active', true)
            ->value('id');
    }

    /**
     * Where a new purchase order is addressed when nobody says: the place the
     * business receives at, else the place the order is being raised from,
     * else Main. Direct delivery and a central warehouse are the same rule
     * read from one flag.
     */
    public static function newOrdersGoTo(string $tenantId): ?string
    {
        if ($marked = self::deliveriesComeTo($tenantId)) {
            return $marked;
        }

        $standing = app(BranchContext::class)->get();
        if ($standing !== null && $standing->tenant_id === $tenantId) {
            return $standing->id;
        }

        return static::withoutTenancy()->where('tenant_id', $tenantId)->where('is_default', true)->value('id');
    }

    /** Places with a counter. */
    public function scopeShops(Builder $query): Builder
    {
        return $query->where('kind', self::KIND_SHOP);
    }

    /** Places that only hold stock. */
    public function scopeWarehouses(Builder $query): Builder
    {
        return $query->where('kind', self::KIND_WAREHOUSE);
    }

    /**
     * REFUSE A COUNTER SALE AT A PLACE THAT HAS NO COUNTER.
     *
     * One rule, asked by every door that sells across a counter: opening a
     * shift, ringing a sale, opening a table. Each of them resolves its branch
     * its own way — a lane, a header, a table's own branch — so the question
     * is put here, about the branch they arrived at, and not re-worded in each.
     *
     * A null branch is a headless path that will fall back to Main, and Main
     * is a shop by the rule above.
     *
     * NOT asked when an online order is completed: a warehouse that
     * `fills_orders` ships them, and the sale that closes such an order is
     * written at the warehouse it came off. That is the caller's to know —
     * see `CreateSaleAction`.
     */
    public static function mustSell(?string $branchId): void
    {
        if ($branchId === null) {
            return;
        }

        // The request has usually resolved this very branch already; ask the
        // database only when it is a different one (a lane's, a table's).
        $operating = app(BranchContext::class)->get();
        $place = $operating !== null && $operating->id === $branchId
            ? $operating
            : static::withoutTenancy()->whereKey($branchId)->first(['id', 'name', 'kind']);

        if ($place !== null && $place->isWarehouse()) {
            throw DomainException::unprocessable(
                "{$place->name} is a warehouse — it holds stock and has no till. Choose a shop to sell from.",
                'WAREHOUSE_DOES_NOT_SELL',
            );
        }
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
