<?php

namespace App\Actions\Expense;

use App\Actions\Pos\RecordCashMovementAction;
use App\Models\Income;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * File manual income, and put it in the drawer if that is where it landed.
 *
 * The mirror of RecordExpenseAction, and needed for the same reason from the
 * other side: rent received in cash is in the till the moment it is handed
 * over. A drawer that doesn't know about it reads the difference as an
 * OVERAGE — and an overage is the variance a shop is least likely to
 * investigate, so the error simply accumulates.
 *
 * Sales revenue never comes through here. The Cashbook derives that from the
 * sales themselves; recording it as income too would double-count every rupee
 * the shop takes.
 */
class RecordIncomeAction
{
    public function __construct(private readonly RecordCashMovementAction $cash) {}

    /**
     * @param  array<string, mixed>  $data
     * @return array{income: Income, warnings: array<int, string>}
     */
    public function execute(User $user, array $data): array
    {
        return DB::transaction(function () use ($user, $data): array {
            $inCash = ($data['payment_method'] ?? 'cash') === 'cash';

            // See RecordExpenseAction: a fresh read is what makes the response
            // a complete row rather than only the fields that were posted.
            $income = Income::query()->create($data)->fresh();

            if ($inCash) {
                $movement = $this->cash->record($user, [
                    'type' => 'income_in',
                    'amount' => (float) $income->amount,
                    'reason' => $income->description,
                    'source_type' => 'income',
                    'source_id' => $income->id,
                ]);

                if ($movement !== null) {
                    $income->forceFill(['cash_movement_id' => $movement->id])->save();
                }
            }

            $warnings = [];

            $duplicate = Income::query()
                ->whereKeyNot($income->id)
                ->where('income_category_id', $income->income_category_id)
                ->where('amount', $income->amount)
                ->whereDate('income_date', $income->income_date)
                ->exists();

            if ($duplicate) {
                $warnings[] = 'A very similar income (same category, amount and date) already exists.';
            }

            if ($inCash && $income->cash_movement_id === null) {
                $warnings[] = 'Recorded as cash, but you have no shift open — the drawer was not adjusted.';
            }

            return ['income' => $income->load('category:id,name'), 'warnings' => $warnings];
        });
    }
}
