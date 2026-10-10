<?php

namespace App\Support;

use App\Models\Expense;
use App\Models\ExpenseBudget;
use App\Models\ExpenseCategory;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * HOW A MONTH IS TRACKING AGAINST ITS CEILINGS — one answer, for every reader.
 *
 * The Budgets tab worked this out for itself, inside its controller. The
 * dashboard then needed the same sentence — "Marketing is over its budget" —
 * and the two ways of getting there were either to copy the arithmetic or to
 * lift it out. Copied, the tab and the dashboard would part company the first
 * time one of them learnt something the other had not (they already had one
 * such lesson between them: a retired category still has its spending).
 *
 * So it lives here, and both read it.
 */
class BudgetStanding
{
    /**
     * Every category with its ceiling and what has been spent against it in a
     * month — including categories with no budget set, because "unbudgeted"
     * and "budget of zero" are different states and the owner needs to see
     * which is which.
     *
     * @return Collection<int, array{
     *     expense_category_id: string, category: string, is_retired: bool,
     *     budget: ?float, standing: ?float, is_override: bool,
     *     spent: float, remaining: ?float, over: bool
     * }>
     */
    public static function forMonth(string $tenantId, Carbon $month, ?string $branchScope): Collection
    {
        $month = $month->copy()->startOfMonth();

        $spend = Expense::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->when($branchScope, fn ($q, $b) => $q->where('branch_id', $b))
            ->whereBetween('expense_date', [$month, $month->copy()->endOfMonth()])
            ->selectRaw('expense_category_id, COALESCE(SUM(amount), 0) as spent')
            ->groupBy('expense_category_id')
            ->pluck('spent', 'expense_category_id');

        // Categories that were spent against this month, whatever became of
        // them since.
        $spentAgainst = array_values(array_filter($spend->keys()->all()));

        // Retiring a category does not unspend its money. Filtering the rows to
        // active categories while the spend map still counted the retired ones
        // meant the page silently dropped real expenditure: a shop that closed
        // "Ramzan Promo" in May was shown an August total lower than what it
        // actually spent, with nothing to click and no hint anything was
        // missing. A retired category earns its row for exactly as long as it
        // has money against it — soft-deleted ones too, for the same reason.
        return ExpenseCategory::withoutTenancy()
            ->withTrashed()
            ->where('tenant_id', $tenantId)
            ->where(fn ($q) => $q->where('is_active', true)->orWhereIn('id', $spentAgainst))
            ->orderBy('name')
            ->get()
            ->map(function (ExpenseCategory $c) use ($month, $branchScope, $spend): array {
                $inForce = ExpenseBudget::inForce($c->id, $month, $branchScope);
                $ceiling = $inForce['amount'];
                $spent = round((float) ($spend[$c->id] ?? 0), 2);

                return [
                    'expense_category_id' => $c->id,
                    'category' => $c->name,
                    // So the screen can mark the row rather than presenting a
                    // closed category as somewhere the shop can still budget.
                    'is_retired' => ! $c->is_active || $c->trashed(),
                    'budget' => $ceiling,
                    // Which row set it, so the screen can offer a box that
                    // edits the one the merchant meant. Without these two the
                    // month-override half of the model is unreachable from any
                    // UI, and clearing a budget uncovers another one without
                    // warning.
                    'standing' => $inForce['standing'],
                    'is_override' => $inForce['is_override'],
                    'spent' => $spent,
                    'remaining' => $ceiling === null ? null : round($ceiling - $spent, 2),
                    'over' => $ceiling !== null && $spent > $ceiling,
                ];
            })
            ->values();
    }
}
