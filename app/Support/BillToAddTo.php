<?php

namespace App\Support;

use App\Exceptions\DomainException;
use App\Models\Sale;

/**
 * THE BILL A NEW SALE IS ADDED TO (Q19 A, the client 2026-10-17).
 *
 * "A customer bought eight items, the bill is printed, they want two more."
 * The paid bill is never changed — it was printed, paid, and perhaps already
 * in the drawer's count. The two more are a new ordinary sale that names it,
 * and its receipt shows both bills and what they come to together.
 *
 * Only while the customer is still at the counter: the same shop-day, the
 * same place, the same kind of drawer (practice or real). A bill from another
 * day is a new visit and a new sale. A cancelled one is not a bill.
 *
 * Always the FIRST bill of the visit: adding to an addition hangs the new one
 * off the same first bill, so one receipt can name them all.
 */
final class BillToAddTo
{
    public static function firstOf(string $id, ?string $branchId, bool $training): Sale
    {
        $bill = Sale::withTraining()->find($id);
        if ($bill === null) {
            throw DomainException::unprocessable("That bill is not one of this shop's.", 'BILL_NOT_FOUND');
        }
        if ($bill->adds_to_sale_id !== null) {
            $bill = Sale::withTraining()->find($bill->adds_to_sale_id) ?? $bill;
        }

        if ($bill->isCancelled()) {
            throw DomainException::unprocessable(
                "{$bill->invoice_number} was cancelled, so nothing can be added to it — ring a new sale.",
                'BILL_CANCELLED',
            );
        }
        if (ShopDay::dateOf($bill->sold_at) !== ShopDay::today()) {
            throw DomainException::unprocessable(
                "{$bill->invoice_number} was rung on another day — ring the extra items as a new sale.",
                'BILL_DAY_OVER',
            );
        }
        if ($bill->branch_id !== $branchId) {
            throw DomainException::unprocessable(
                "{$bill->invoice_number} was rung at another place — add to it there, or ring a new sale.",
                'BILL_ELSEWHERE',
            );
        }
        if ((bool) $bill->is_training !== $training) {
            throw DomainException::unprocessable(
                $training
                    ? "{$bill->invoice_number} is a real sale and this drawer is a practice one."
                    : "{$bill->invoice_number} was a practice sale — nothing real can be added to it.",
                'BILL_PRACTICE',
            );
        }

        return $bill;
    }

    /**
     * THE VISIT A BILL BELONGS TO — the first bill and every one added to it,
     * oldest first, and what the standing ones come to together. Null for a
     * bill on its own. Read by the till's sheet, the sale's page and the
     * receipt, so all three name the same bills and the same sum.
     *
     * @return array{first_id: string, bills: list<array{id: string, invoice_number: string, total: float, cancelled: bool}>, together: float}|null
     */
    public static function visit(Sale $sale): ?array
    {
        $first = $sale->adds_to_sale_id === null ? $sale : Sale::withTraining()->find($sale->adds_to_sale_id);
        if ($first === null) {
            return null;
        }

        $bills = collect([$first])->concat(
            Sale::withTraining()->where('adds_to_sale_id', $first->id)->orderBy('created_at')->orderBy('id')->get(),
        );
        if ($bills->count() < 2) {
            return null;
        }

        return [
            'first_id' => $first->id,
            'bills' => $bills->map(fn (Sale $bill): array => [
                'id' => $bill->id,
                'invoice_number' => $bill->invoice_number,
                'total' => (float) $bill->total,
                'cancelled' => $bill->isCancelled(),
            ])->values()->all(),
            // A bill cancelled since is not part of what was paid for.
            'together' => round((float) $bills->reject(fn (Sale $bill) => $bill->isCancelled())->sum(fn (Sale $bill) => (float) $bill->total), 2),
        ];
    }
}
