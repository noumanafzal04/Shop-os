<?php

namespace App\Support;

use App\Models\Customer;
use App\Models\CustomerLedgerEntry;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Builder;

/**
 * MONEY HANDED OVER AGAINST KHATA — A COLLECTION, NEVER A SALE.
 *
 * A credit sale is counted in Sales and Reports on the day it is rung, at its
 * full amount. What the customer pays later is the same money arriving, so it
 * must never be added to sales or profit again. It still has to be SEEN: a
 * cash payment lands in a drawer (`khata_in`) and so on the day's close, but a
 * transfer, card or wallet payment reached no screen except the customer's own
 * statement (L14). This is the one place that says which payments those are.
 *
 * Not a collection: a return or a cancellation, which take a khata down as a
 * `payment` too (`Customer::NOT_COLLECTIONS`).
 *
 * A branch is asked strictly. Payments from before a payment carried its branch
 * have none, and are counted only across the whole shop — a chain's day must
 * not show another counter's money because nobody wrote down where it came in.
 */
final class KhataCollected
{
    public static function query(string $tenantId, ?string $branchId, DateTimeInterface $from, DateTimeInterface $to): Builder
    {
        return CustomerLedgerEntry::withoutTenancy()
            ->where('customer_ledger_entries.tenant_id', $tenantId)
            ->where('customer_ledger_entries.type', 'payment')
            ->whereNotIn('customer_ledger_entries.method', Customer::NOT_COLLECTIONS)
            ->whereBetween('customer_ledger_entries.created_at', [$from, $to])
            ->when($branchId, fn ($q) => $q->where('customer_ledger_entries.branch_id', $branchId));
    }

    /**
     * @return array{total: float, count: int, by_method: array<int, array{method: string, total: float, count: int}>}
     */
    public static function between(string $tenantId, ?string $branchId, DateTimeInterface $from, DateTimeInterface $to): array
    {
        $rows = self::query($tenantId, $branchId, $from, $to)
            ->toBase()
            ->selectRaw('method, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total')
            ->groupBy('method')
            ->orderByDesc('total')
            ->get();

        return [
            'total' => round((float) $rows->sum('total'), 2),
            'count' => (int) $rows->sum('n'),
            'by_method' => $rows->map(fn ($r) => [
                'method' => (string) $r->method,
                'total' => round((float) $r->total, 2),
                'count' => (int) $r->n,
            ])->values()->all(),
        ];
    }
}
