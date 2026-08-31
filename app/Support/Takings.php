<?php

namespace App\Support;

use App\Enums\SaleStatus;
use App\Models\SaleReturn;
use Illuminate\Database\Eloquent\Builder;

/**
 * WHICH SALES COUNT AS TRADING.
 *
 * One question, asked eighteen times across the reports, the dashboard, the
 * ledger and the drawer — and answered two different ways.
 *
 * The house model is written down in `ReportService::cashbook`:
 *
 *   "A sale that was later refunded still brought its money in — only a
 *    CANCELLED sale never happened."
 *
 * and:
 *
 *   "Partially/fully refunded sales keep their original revenue on the day it
 *    came in AND show the refund on the day it went out, so the money movement
 *    reconciles."
 *
 * The cashbook follows it. The drawer follows it. The Z-read and the closed-off
 * day follow it. The SALES REPORT and the DASHBOARD did not: thirteen queries
 * asked for `status = completed` and nothing else, so the moment a customer
 * brought one item back off a large invoice, the ENTIRE invoice left the
 * revenue figure, the chart, the top-products list, the margin report, the
 * staff report and the tax return.
 *
 * Measured on a mart's day: a 1,000 sale with one 250 bag returned. The
 * cashbook, the day and the Z-read said the shop took 2,250. The sales report
 * and the dashboard said 1,250 — which is neither the gross (2,250) nor the net
 * (2,000), because a whole ticket had simply gone.
 *
 * ── Why gross, and not net ──────────────────────────────────────────────
 *
 * Because a refund is dated by when it was HANDED BACK, not by when the sale
 * was rung. A bag returned on Thursday against Monday's invoice cannot be
 * netted off Monday without rewriting a day that has already been closed,
 * counted and banked. Gross revenue plus a dated refund line is the only shape
 * where both days reconcile — which is exactly why the cashbook was built that
 * way, and exactly what the P&L screens were missing.
 *
 * A CANCELLED sale is not here on purpose: a void never happened. Its tender
 * still passed through the drawer, which is a different question and is
 * answered by `DrawerMath::RUNG_STATUSES` — the only place that needs to see
 * the notes rather than the trade.
 */
final class Takings
{
    /** @var array<int, SaleStatus> */
    public const COUNTED = [
        SaleStatus::Completed,
        SaleStatus::PartiallyRefunded,
        SaleStatus::Refunded,
    ];

    /**
     * Narrow a sales query to the trades that count.
     *
     * `$column` because half these queries join and must say `sales.status`; a
     * bare `status` there is ambiguous and the database says so.
     */
    public static function counted(Builder $query, string $column = 'status'): Builder
    {
        return $query->whereIn($column, self::COUNTED);
    }

    /**
     * What the shop handed back, dated by the day it went out.
     *
     * Beside the status rule rather than in the callers, because the two are
     * one model: revenue is gross ONLY as long as the refund is reported next
     * to it. A screen that adopts the first half and not the second overstates
     * every day a customer came back.
     */
    public static function refunds(string $tenantId, ?string $branchId): Builder
    {
        return SaleReturn::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId));
    }
}
