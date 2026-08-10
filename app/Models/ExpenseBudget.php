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
        return self::inForce($categoryId, $month, $branchId)['amount'];
    }

    /**
     * The ceiling in force AND which of the two rows set it.
     *
     * The effective figure alone is not enough to edit a budget: a screen that
     * shows "90,000" without saying whether that is the standing number or
     * this month's override cannot offer a box to change it — whichever row it
     * wrote would be wrong half the time, and clearing the box would silently
     * uncover a different ceiling underneath. So the caller gets both.
     *
     * @return array{amount: ?float, standing: ?float, is_override: bool}
     */
    public static function inForce(string $categoryId, Carbon $month, ?string $branchId = null): array
    {
        $rows = self::query()
            ->where('expense_category_id', $categoryId)
            ->when(
                $branchId !== null,
                // Standing at a branch: its own ceiling, falling back to the
                // company-wide one when it has not set its own.
                fn ($q) => $q->where(fn ($w) => $w->where('branch_id', $branchId)->orWhereNull('branch_id')),
                // The all-branches view: ONLY a company-wide ceiling counts. A
                // limit one shop set for itself is not the company's limit, and
                // reporting it as one told an owner "Rent is 30,000 over budget"
                // against a number the company never set — for spending that
                // happened at a branch with no budget at all.
                fn ($q) => $q->whereNull('branch_id'),
            )
            ->where(fn ($q) => $q->whereNull('month')->orWhereDate('month', $month->copy()->startOfMonth()))
            // A dated row sorts after a NULL one, so the override wins.
            ->orderByRaw('month is null desc')
            ->get();

        $specific = $rows->firstWhere(fn (self $b) => $b->month !== null);
        $standing = $rows->firstWhere(fn (self $b) => $b->month === null);

        $chosen = $specific ?? $standing;

        return [
            'amount' => $chosen !== null ? (float) $chosen->amount : null,
            'standing' => $standing !== null ? (float) $standing->amount : null,
            'is_override' => $specific !== null,
        ];
    }
}
