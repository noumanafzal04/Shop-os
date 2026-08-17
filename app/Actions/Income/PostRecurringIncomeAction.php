<?php

namespace App\Actions\Income;

use App\Actions\Expense\RecordIncomeAction;
use App\Exceptions\DomainException;
use App\Models\Income;
use App\Models\RecurringIncome;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Turn a due recurring template into a real income row.
 *
 * The amount is overridable at this moment on purpose, and it matters more on
 * this side than on the expense side: a tenant who pays short this month HAS
 * paid short, and a template that forces the agreed figure files a receipt for
 * money nobody received. The template carries the usual amount as a starting
 * point, never as a verdict.
 *
 * The schedule advances from the DUE date rather than from today, so rent
 * collected four days late doesn't drag every future month four days later
 * with it. A template left unposted for three months catches up one period at
 * a time — each of those months genuinely had rent owing, and skipping to the
 * future would erase two of them.
 */
class PostRecurringIncomeAction
{
    public function __construct(private readonly RecordIncomeAction $record) {}

    /**
     * @param  array{amount?: float|int|string|null, income_date?: ?string, payment_method?: ?string, reference?: ?string, notes?: ?string}  $overrides
     * @return array{income: Income, warnings: array<int, string>, template: RecurringIncome}
     */
    public function execute(User $user, RecurringIncome $template, array $overrides = []): array
    {
        return DB::transaction(function () use ($user, $template, $overrides): array {
            /** @var RecurringIncome $locked */
            $locked = RecurringIncome::query()->whereKey($template->id)->lockForUpdate()->firstOrFail();

            if (! $locked->is_active) {
                throw DomainException::conflict('This recurring income is paused.', 'RECURRING_PAUSED');
            }

            $dueOn = Carbon::parse($locked->next_due_on);

            // Posting ahead of the due date would advance the schedule past a
            // period that hasn't happened, quietly skipping it.
            if ($dueOn->isFuture()) {
                throw DomainException::unprocessable(
                    "{$locked->description} isn't due until {$dueOn->toFormattedDateString()}.",
                    'RECURRING_NOT_DUE',
                );
            }

            $result = $this->record->execute($user, [
                'income_category_id' => $locked->income_category_id,
                'branch_id' => $locked->branch_id,
                'description' => $locked->description,
                'reference' => $overrides['reference'] ?? null,
                'amount' => round((float) ($overrides['amount'] ?? $locked->amount), 2),
                'payment_method' => $overrides['payment_method'] ?? $locked->payment_method,
                'income_date' => $overrides['income_date'] ?? $dueOn->toDateString(),
                'notes' => $overrides['notes'] ?? $locked->notes,
                'recurring_income_id' => $locked->id,
            ]);

            $locked->update([
                'last_posted_on' => now()->toDateString(),
                'next_due_on' => $locked->advance($dueOn)->toDateString(),
            ]);

            return $result + ['template' => $locked->fresh()];
        });
    }
}
