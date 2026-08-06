<?php

namespace App\Actions\Expense;

use App\Exceptions\DomainException;
use App\Models\Expense;
use App\Models\RecurringExpense;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Turn a due recurring template into a real expense.
 *
 * The amount is overridable at this moment on purpose: electricity never bills
 * twice the same, and a template that forces last month's figure files a wrong
 * one every month. The template carries the usual amount as a starting point,
 * not as a verdict.
 *
 * The schedule advances from the DUE date rather than from today, so a bill
 * posted four days late doesn't drag every future month four days later with
 * it. A template left unposted for three months catches up one period at a
 * time — each of those months genuinely had a bill, and skipping straight to
 * the future would erase two of them.
 */
class PostRecurringExpenseAction
{
    public function __construct(private readonly RecordExpenseAction $record) {}

    /**
     * @param  array{amount?: float|int|string|null, expense_date?: ?string, payment_method?: ?string, reference?: ?string, notes?: ?string}  $overrides
     * @return array{expense: Expense, warnings: array<int, string>, template: RecurringExpense}
     */
    public function execute(User $user, RecurringExpense $template, array $overrides = []): array
    {
        return DB::transaction(function () use ($user, $template, $overrides): array {
            /** @var RecurringExpense $locked */
            $locked = RecurringExpense::query()->whereKey($template->id)->lockForUpdate()->firstOrFail();

            if (! $locked->is_active) {
                throw DomainException::conflict('This recurring expense is paused.', 'RECURRING_PAUSED');
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
                'expense_category_id' => $locked->expense_category_id,
                'supplier_id' => $locked->supplier_id,
                'branch_id' => $locked->branch_id,
                'description' => $locked->description,
                'reference' => $overrides['reference'] ?? null,
                'amount' => round((float) ($overrides['amount'] ?? $locked->amount), 2),
                'payment_method' => $overrides['payment_method'] ?? $locked->payment_method,
                'expense_date' => $overrides['expense_date'] ?? $dueOn->toDateString(),
                'notes' => $overrides['notes'] ?? $locked->notes,
                'recurring_expense_id' => $locked->id,
            ]);

            $locked->update([
                'last_posted_on' => now()->toDateString(),
                'next_due_on' => $locked->advance($dueOn)->toDateString(),
            ]);

            return $result + ['template' => $locked->fresh()];
        });
    }
}
