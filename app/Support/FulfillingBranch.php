<?php

namespace App\Support;

use App\Models\Branch;
use App\Models\BranchStock;
use Illuminate\Support\Collection;

/**
 * WHICH BRANCH FILLS AN ONLINE ORDER.
 *
 * Until now: the default one, always, because nothing on `orders` named a
 * branch and `InventoryService` falls back to Main. For a single-shop business
 * that is correct and this class changes nothing for them. For a chain it meant
 * the online shop was Main's shop — ten in Gulberg and none in Main refused the
 * order and said "only 0 in stock", about a shelf the goods were never going to
 * come off.
 *
 * ── The rule ────────────────────────────────────────────────────────────
 *
 * **The nearest branch that actually holds the whole basket.**
 *
 * Nearest alone is not enough, and the difference is the whole point of a
 * chain: if the branch round the corner is out of one line, a shop would fill
 * the order from the next one along rather than turn the customer away. Asking
 * only "which is closest" would refuse an order the business can plainly
 * fulfil.
 *
 * One branch fills the whole basket. Splitting it across two is two riders,
 * two delivery fees and two things to go wrong, and it is not what a shop does
 * with a twelve-item order. When no single branch holds all of it the caller
 * falls back to the nearest, and the ordinary per-line stock check then refuses
 * with a message that names the ITEM — which is the thing the customer and the
 * shop can both act on.
 *
 * ── When there is no pin ────────────────────────────────────────────────
 *
 * A customer who never shared a location, an order taken over the phone, a
 * branch whose own coordinates were never set. Distance is unanswerable, so
 * ranking falls back to the shop's default branch first. That is deliberately
 * the OLD behaviour: a shop that has not put its branches on a map gets exactly
 * what it had before rather than a silent reshuffle it never asked for.
 */
final class FulfillingBranch
{
    /**
     * The branches that could fill this order, nearest first.
     *
     * Every active branch, because a chain's stock is spread across all of
     * them. Ordered by distance from the delivery pin when both ends have one;
     * a branch with no coordinates sorts last among its peers rather than being
     * dropped, since it can still fill an order — it just cannot be measured.
     *
     * @return Collection<int, Branch>
     */
    public static function ranked(string $tenantId, ?float $lat, ?float $lng): Collection
    {
        $branches = Branch::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->orderByDesc('is_default')
            ->orderBy('name')
            ->get();

        if ($lat === null || $lng === null || $branches->count() < 2) {
            return $branches;
        }

        return $branches
            ->sortBy(fn (Branch $b): float => self::distance($b, $lat, $lng))
            ->values();
    }

    /**
     * The first of them holding every line — or null if no single branch does.
     *
     * `$need` is keyed `productId` or `productId:variantId` and carries base
     * units, which is the shape `BranchStock` is keyed in and the shape the
     * order's own hold uses. It is built by `OrderService::stockDraw()` — the
     * SAME function the hold calls — because a resolver that worked out the
     * basket its own way would answer a slightly different question from the
     * one the stock is actually taken against, and the two would drift apart on
     * the first pack or deal anybody sold.
     *
     * @param  Collection<int, Branch>  $ranked
     * @param  array<string, float>  $need
     */
    public static function holdingAll(Collection $ranked, array $need): ?Branch
    {
        if ($need === []) {
            // Nothing tracked in the basket — a service, a made-to-order dish.
            // Every branch can fill it, so the nearest wins on distance alone.
            return $ranked->first();
        }

        foreach ($ranked as $branch) {
            if (self::holds($branch, $need)) {
                return $branch;
            }
        }

        return null;
    }

    /** @param  array<string, float>  $need */
    private static function holds(Branch $branch, array $need): bool
    {
        $onHand = BranchStock::withoutTenancy()
            ->where('branch_id', $branch->id)
            ->get()
            ->mapWithKeys(fn (BranchStock $row): array => [
                $row->product_id.($row->variant_id === null ? '' : ':'.$row->variant_id) => (float) $row->quantity,
            ]);

        foreach ($need as $key => $qty) {
            if (($onHand[$key] ?? 0.0) < $qty) {
                return false;
            }
        }

        return true;
    }

    /**
     * Kilometres, or effectively infinite when the branch is not on a map.
     *
     * `PHP_FLOAT_MAX` rather than dropping it: an unmapped branch is still a
     * branch that can fill an order, and a chain that has pinned two of its
     * five must not have the other three quietly stop existing.
     */
    private static function distance(Branch $branch, float $lat, float $lng): float
    {
        if ($branch->latitude === null || $branch->longitude === null) {
            return PHP_FLOAT_MAX;
        }

        return Geo::distanceKm($lat, $lng, (float) $branch->latitude, (float) $branch->longitude);
    }
}
