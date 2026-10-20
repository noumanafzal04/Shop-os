<?php

namespace App\Support;

use App\Enums\SaleStatus;
use App\Models\Sale;
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
    /**
     * WHAT A SALE TOOK, AND WHAT A RETURN HANDED BACK — an exchange taken off
     * both (B21).
     *
     * An exchange is goods back and goods out in one step, the value of what
     * came back paying for the replacement. Counted whole on both sides, a
     * shirt swapped for a dearer one read as 2,000 refunded and 2,500 sold,
     * where 500 came in and nothing went out. The credit that paid for the
     * replacement is kept on both rows (`exchange_credit`) and taken off both
     * here. The net is unchanged, and both halves fall on the same day at the
     * same place — so, unlike netting a refund off its sale, no closed day is
     * rewritten.
     *
     * As SQL for a sum (`$table` for a query that joins), and per row for a
     * collection already fetched with the column.
     */
    public static function takenSql(string $table = 'sales'): string
    {
        return "{$table}.total - {$table}.exchange_credit";
    }

    /**
     * THE ROUNDING ON A CASH BILL (B2, B11 of the full re-test). A bill of
     * 116.99 settled at 120 keeps its total — tax is struck on it — and the
     * 3.01 is its `rounding_adjustment` (CashRounding). The shop holds that
     * money all the same, so the books that count money — Cashbook, Ledger,
     * net profit — add it on its own line. Revenue does not: it is no sale.
     */
    public static function roundingSql(string $table = 'sales'): string
    {
        return "COALESCE({$table}.rounding_adjustment, 0)";
    }

    public static function handedBackSql(string $table = 'sale_returns'): string
    {
        return "{$table}.refund_total - {$table}.exchange_credit";
    }

    public static function taken(Sale $sale): float
    {
        return (float) $sale->total - (float) $sale->exchange_credit;
    }

    public static function handedBack(SaleReturn $return): float
    {
        return (float) $return->refund_total - (float) $return->exchange_credit;
    }

    public static function refunds(string $tenantId, ?string $branchId): Builder
    {
        return SaleReturn::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId));
    }
}
