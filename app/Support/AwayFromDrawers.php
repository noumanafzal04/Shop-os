<?php

namespace App\Support;

use App\Enums\SaleStatus;
use App\Models\BusinessDay;
use App\Models\Sale;
use Illuminate\Support\Facades\DB;

/**
 * THE DAY'S SALES THAT NO DRAWER TOOK (B14).
 *
 * A day's "Rung up" was the sum of its shifts, so a sale made with no shift —
 * a phone order delivered and paid on the doorstep, anything sold in a shop
 * that does not ask for shifts, or before the first one was opened — was in
 * the shop's revenue and in no day. Main's day said 22,690 from 6 sales while
 * Main had sold 31,580 in 8.
 *
 * Counted BESIDE the drawers, never in them: whatever cash such a sale brought
 * reached a drawer some other way (a rider's hand-in) or not at all, and a
 * drawer's expected cash must not be told otherwise.
 */
final class AwayFromDrawers
{
    /** @return array{sales_count: int, sales_total: float} */
    public static function of(BusinessDay $day): array
    {
        // Sales written before places existed carry none, which is Main's.
        return self::on($day->tenant_id, $day->trading_date->toDateString(), $day->branch_id, (bool) $day->branch?->is_default);
    }

    /**
     * The same, for a date with no day row at all (#SV1): a shop that never
     * opens a drawer — a tailor billing from the job board — has no day, and
     * its Day & banking said "No day open yet" with Rs 5,630 taken. A null
     * branch is every branch, as the owner's "All branches" view asks.
     *
     * @return array{sales_count: int, sales_total: float}
     */
    public static function on(string $tenantId, string $date, ?string $branchId, bool $isMain): array
    {
        $tenant = ShopDay::shop($tenantId);

        $sold = Sale::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereNull('cash_session_id')
            ->whereIn('status', [SaleStatus::Completed, SaleStatus::PartiallyRefunded, SaleStatus::Refunded])
            ->when($branchId !== null, fn ($q) => $q->where(fn ($at) => $at
                ->where('branch_id', $branchId)
                ->when($isMain, fn ($main) => $main->orWhereNull('branch_id'))))
            ->whereBetween('sold_at', [ShopDay::startOf($date, $tenant), ShopDay::endOf($date, $tenant)]);

        return [
            'sales_count' => (int) (clone $sold)->count(),
            'sales_total' => round((float) (clone $sold)->sum(DB::raw(Takings::takenSql())), 2),
        ];
    }
}
