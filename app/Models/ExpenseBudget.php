<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A monthly ceiling on one expense category.
 *
 * A NULL month is the standing budget — the number that applies every month. A
 * dated row overrides it for that month alone, which is how a shop actually
 * budgets: one figure all year, except the month the annual licence falls due.
 */
class ExpenseBudget extends Model
{
    use Auditable, BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'month' => 'date',
        ];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(ExpenseCategory::class, 'expense_category_id')->withTrashed();
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    /**
     * The ceiling in force for a category in a given month: the month's own row
     * if one exists, otherwise the standing one. Returns null when the category
     * is unbudgeted, which is not the same as a budget of zero.
     */
    public static function ceilingFor(string $categoryId, Carbon $month, ?string $branchId = null): ?float
    {
        $rows = self::query()
            ->where('expense_category_id', $categoryId)
            ->when($branchId !== null, fn ($q) => $q->where(fn ($w) => $w->where('branch_id', $branchId)->orWhereNull('branch_id')))
            ->where(fn ($q) => $q->whereNull('month')->orWhereDate('month', $month->copy()->startOfMonth()))
            // A dated row sorts after a NULL one, so the override wins.
            ->orderByRaw('month is null desc')
            ->get();

        $specific = $rows->firstWhere(fn (self $b) => $b->month !== null);
        $standing = $rows->firstWhere(fn (self $b) => $b->month === null);

        $chosen = $specific ?? $standing;

        return $chosen !== null ? (float) $chosen->amount : null;
    }
}
