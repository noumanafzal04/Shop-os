<?php

namespace App\Support;

use App\Enums\SaleStatus;
use App\Models\BusinessDay;
use App\Models\Sale;

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
        $tenant = ShopDay::shop($day->tenant_id);
        $date = $day->trading_date->toDateString();
        // Sales written before places existed carry none, which is Main's.
        $isMain = (bool) $day->branch?->is_default;

        $sold = Sale::withoutTenancy()
            ->where('tenant_id', $day->tenant_id)
            ->whereNull('cash_session_id')
            ->whereIn('status', [SaleStatus::Completed, SaleStatus::PartiallyRefunded, SaleStatus::Refunded])
            ->where(fn ($at) => $at
                ->where('branch_id', $day->branch_id)
                ->when($isMain, fn ($main) => $main->orWhereNull('branch_id')))
            ->whereBetween('sold_at', [ShopDay::startOf($date, $tenant), ShopDay::endOf($date, $tenant)]);

        return [
            'sales_count' => (int) (clone $sold)->count(),
            'sales_total' => round((float) (clone $sold)->sum('total'), 2),
        ];
    }
}
