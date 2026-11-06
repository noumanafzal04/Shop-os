<?php

namespace App\Support;

use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Product;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/**
 * WHERE AN ITEM OR A CATEGORY IS SOLD (v2, the owner's rules of 2026-10-18 and
 * 2026-11-06). One place for every rule, so the product form, the category
 * screen, the import and the till cannot each decide it differently.
 *
 *   The OWNER lists an item at every branch ("All") or at the ones named.
 *   So does anyone the owner has given `products.any_branch` — the owner does
 *   not share their login to have one trusted person run the catalogue —
 *   except that what they make with nothing ticked starts at their own branch.
 *   Other STAFF are pinned to one branch (ResolveBranch): what they make is
 *   listed there, and what is listed anywhere else is not theirs to change —
 *   they still set its price and stock at their own branch, on the screens
 *   that already do that.
 *
 *   A shop with ONE selling branch never meets any of this: "All" and "here"
 *   are the same place, so staff make and change items exactly as before, and
 *   what they make is listed everywhere — a second branch opened next month
 *   gets it, rather than finding the counter's catalogue split down the middle.
 *
 *   A GODOWN sells nothing and holds everything: it is never a listing, and a
 *   list asked for at a godown is the whole catalogue.
 */
final class CatalogPlaces
{
    /** Branches that sell — shops, active — of the current tenant. @return list<string> */
    public static function sellingBranchIds(): array
    {
        return Branch::query()
            ->where('is_active', true)
            ->where('kind', Branch::KIND_SHOP)
            ->pluck('id')
            ->map(fn ($id) => (string) $id)
            ->all();
    }

    /** The owner, or someone the owner let list at every branch. */
    public static function choosesBranches(User $user): bool
    {
        return $user->isShopOwner() || $user->hasPermission(Permissions::PRODUCTS_ANY_BRANCH);
    }

    /**
     * What a write may set, from what it asked: `all_branches` and/or
     * `branch_ids`. Null when it asked nothing — a create then lists the item
     * everywhere, an update leaves where it is listed alone.
     *
     * @param  array<int, string>|null  $ids
     * @return array{all: bool, ids: list<string>}|null
     */
    public static function resolve(User $user, ?bool $all, ?array $ids, ?string $own): ?array
    {
        $selling = self::sellingBranchIds();
        $asked = $all !== null || $ids !== null;

        if (self::choosesBranches($user)) {
            if (! $asked || $all === true) {
                return $asked ? ['all' => true, 'ids' => []] : null;
            }
            $named = array_values(array_unique(array_intersect(array_map('strval', $ids ?? []), $selling)));
            if ($named === []) {
                throw DomainException::unprocessable('Choose at least one branch, or All branches.', 'BRANCH_REQUIRED');
            }

            return ['all' => false, 'ids' => $named];
        }

        // One selling branch: "here" IS everywhere.
        if (count($selling) <= 1 || $own === null || ! in_array($own, $selling, true)) {
            return $asked ? ['all' => true, 'ids' => []] : null;
        }

        $others = array_diff(array_map('strval', $ids ?? []), [$own]);
        if ($all === true || $others !== []) {
            throw DomainException::forbidden('Only the owner, or someone the owner allows, can list this at other branches.', 'BRANCH_NOT_YOURS');
        }

        return ['all' => false, 'ids' => [$own]];
    }

    /** A new item or category made by this person, when the write named no branches. @return array{all: bool, ids: list<string>} */
    public static function forNew(User $user, ?string $own): array
    {
        $selling = self::sellingBranchIds();
        if ($user->isShopOwner() || count($selling) <= 1 || $own === null || ! in_array($own, $selling, true)) {
            return ['all' => true, 'ids' => []];
        }
        // Everyone else — a branch manager, or someone who MAY choose but did
        // not — starts at the branch they work at; a wider listing is ticked.

        return ['all' => false, 'ids' => [$own]];
    }

    /** May this person change something listed like this? */
    public static function mayChange(User $user, Model $item, ?string $own): bool
    {
        if (self::choosesBranches($user)) {
            return true;
        }
        $selling = self::sellingBranchIds();
        if (count($selling) <= 1) {
            return true;
        }
        if ($item->getAttribute('all_branches')) {
            return false;
        }
        $at = self::listedIds($item);

        return $own !== null && $at === [$own];
    }

    public static function assertMayChange(User $user, Model $item, ?string $own): void
    {
        if (! self::mayChange($user, $item, $own)) {
            throw DomainException::forbidden(
                'This is sold at other branches too — only the owner, or someone the owner allows, can change it. You can still set its price and stock at your branch.',
                'BRANCH_NOT_YOURS',
            );
        }
    }

    /** Write a resolved listing onto a product or category. @param array{all: bool, ids: list<string>} $places */
    public static function save(Model $item, array $places): void
    {
        DB::transaction(function () use ($item, $places): void {
            // touch(), not save(): a move from one branch to another changes no
            // column of the item, and the till's catalog travels by
            // updated_at — without it the till that lost the item keeps it.
            $item->forceFill(['all_branches' => $places['all']])->touch();
            $table = self::pivot($item);
            $key = self::key($item);
            DB::table($table)->where($key, $item->getKey())->delete();
            if (! $places['all']) {
                DB::table($table)->insert(array_map(fn (string $b) => [
                    'tenant_id' => $item->getAttribute('tenant_id'),
                    $key => $item->getKey(),
                    'branch_id' => $b,
                ], $places['ids']));
            }
            if ($item instanceof Product) {
                self::touchShelf($item);
            }
        });
    }

    /**
     * A product's listing decides whether its category shows at a branch, but
     * the till's categories travel by THEIR updated_at — so a re-listed item's
     * shelf, and every shelf above it, is touched with it.
     */
    public static function touchShelf(Product $product): void
    {
        $at = $product->getAttribute('category_id');
        for ($guard = 0; $at !== null && $guard < 50; $guard++) {
            $row = Category::query()->whereKey($at)->first(['id', 'parent_id']);
            if ($row === null) {
                break;
            }
            Category::query()->whereKey($row->id)->update(['updated_at' => now()]);
            $at = $row->parent_id;
        }
    }

    /** The branches an item is listed at by name (empty when it is at all of them). @return list<string> */
    public static function listedIds(Model $item): array
    {
        return DB::table(self::pivot($item))
            ->where(self::key($item), $item->getKey())
            ->pluck('branch_id')
            ->map(fn ($id) => (string) $id)
            ->sort()->values()->all();
    }

    /**
     * Stock that ARRIVES at a branch — a transfer, a delivery — lists the item
     * there if it was not (v2). Stock a branch holds and cannot sell is stock
     * the counter is asked about and must turn away.
     */
    public static function listArrivalAt(Product $product, ?string $branchId): void
    {
        if (self::isSoldAt($product, $branchId) || ! in_array((string) $branchId, self::sellingBranchIds(), true)) {
            return;
        }
        DB::table('branch_product')->insertOrIgnore([
            'tenant_id' => $product->getAttribute('tenant_id'),
            'product_id' => $product->getKey(),
            'branch_id' => $branchId,
        ]);
        $product->touch();
        self::touchShelf($product);
    }

    /** Is this item sold at that branch? Null (no branch) and a godown: yes. */
    public static function isSoldAt(Model $item, ?string $branchId): bool
    {
        if ($branchId === null || self::isGodown($branchId) || $item->getAttribute('all_branches') !== false) {
            return true;
        }

        return DB::table(self::pivot($item))
            ->where(self::key($item), $item->getKey())
            ->where('branch_id', $branchId)
            ->exists();
    }

    /**
     * Of these products, the ones sold at that branch — one query for a page.
     * Null when nothing is narrowed.
     *
     * @param  iterable<Product>  $products
     * @return array<string, true>|null
     */
    public static function productsSoldAt(?string $branchId, iterable $products): ?array
    {
        if ($branchId === null || self::isGodown($branchId)) {
            return null;
        }
        $sold = [];
        $named = [];
        foreach ($products as $p) {
            if ($p->getAttribute('all_branches') === false) {
                $named[] = (string) $p->getKey();
            } else {
                $sold[(string) $p->getKey()] = true;
            }
        }
        if ($named !== []) {
            foreach (array_chunk($named, 500) as $chunk) {
                DB::table('branch_product')->whereIn('product_id', $chunk)->where('branch_id', $branchId)
                    ->pluck('product_id')->each(function ($id) use (&$sold): void {
                        $sold[(string) $id] = true;
                    });
            }
        }

        return $sold;
    }

    /**
     * Narrow a product or category query to what is sold at this branch. Null
     * (the owner's "All branches") and a godown narrow nothing.
     */
    public static function narrow(Builder $query, ?string $branchId, string $table, string $pivot, string $key): Builder
    {
        if ($branchId === null || self::isGodown($branchId)) {
            return $query;
        }

        return $query->where(fn (Builder $w) => $w
            ->where("{$table}.all_branches", true)
            ->orWhereExists(fn ($e) => $e->selectRaw('1')->from($pivot)
                ->whereColumn("{$pivot}.{$key}", "{$table}.id")
                ->where("{$pivot}.branch_id", $branchId)));
    }

    /**
     * What a COUNT at this branch puts on the sheet: what it sells, and what
     * is still on its shelf though it no longer sells it — stock that is there
     * is counted whatever the catalogue says, or it is never found missing.
     */
    public static function narrowHeld(Builder $query, ?string $branchId): Builder
    {
        if ($branchId === null || self::isGodown($branchId)) {
            return $query;
        }

        return $query->where(fn (Builder $w) => $w
            ->where('products.all_branches', true)
            ->orWhereExists(fn ($e) => $e->selectRaw('1')->from('branch_product')
                ->whereColumn('branch_product.product_id', 'products.id')
                ->where('branch_product.branch_id', $branchId))
            ->orWhereExists(fn ($e) => $e->selectRaw('1')->from('branch_stock')
                ->whereColumn('branch_stock.product_id', 'products.id')
                ->where('branch_stock.branch_id', $branchId)
                ->where('branch_stock.quantity', '<>', 0)));
    }

    /**
     * The categories to show at a branch: listed there, or holding something
     * that is sold there (a one-branch category's all-branch item still needs a
     * shelf to stand on) — and every parent above one of those, so the tree
     * keeps its path. Null when nothing is narrowed.
     *
     * @return array<string, true>|null
     */
    public static function categoriesShownAt(?string $branchId): ?array
    {
        if ($branchId === null || self::isGodown($branchId)) {
            return null;
        }

        $shown = Category::query()->listedAt($branchId)->pluck('id')
            ->merge(Product::query()->listedAt($branchId)->whereNotNull('category_id')->distinct()->pluck('category_id'))
            ->map(fn ($id) => (string) $id)->unique()->all();

        $parents = Category::query()->pluck('parent_id', 'id')->map(fn ($p) => $p === null ? null : (string) $p)->all();
        $keep = [];
        foreach ($shown as $id) {
            for ($at = $id, $guard = 0; $at !== null && ! isset($keep[$at]) && $guard < 50; $guard++) {
                $keep[$at] = true;
                $at = $parents[$at] ?? null;
            }
        }

        return $keep;
    }

    private static function isGodown(string $branchId): bool
    {
        static $kinds = [];

        return ($kinds[$branchId] ??= (string) Branch::query()->whereKey($branchId)->value('kind')) === Branch::KIND_WAREHOUSE;
    }

    private static function pivot(Model $item): string
    {
        return $item instanceof Category ? 'branch_category' : 'branch_product';
    }

    private static function key(Model $item): string
    {
        return $item instanceof Category ? 'category_id' : 'product_id';
    }
}
