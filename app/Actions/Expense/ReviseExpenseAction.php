<?php

namespace App\Actions\Expense;

use App\Exceptions\DomainException;
use App\Models\CashMovement;
use App\Models\Expense;
use Illuminate\Support\Facades\DB;

/**
 * Edit or delete an expense, keeping the drawer honest.
 *
 * An expense that moved cash is two records, not one, and they must not drift
 * apart. The rule is the cash book's own, and it turns on whether the shift has
 * been counted:
 *
 *   SHIFT STILL OPEN    the drawer hasn't been counted, so the mistake is
 *                       simply corrected — the movement is amended or removed
 *                       alongside the expense.
 *
 *   SHIFT CLOSED        somebody counted that drawer, signed off a variance and
 *                       went home. Rewriting the movement now changes a figure
 *                       that has already been reconciled, and deleting it
 *                       leaves the shift short with no record of why. Refused;
 *                       the fix is a compensating entry, which is how cash
 *                       books have always handled yesterday.
 */
class ReviseExpenseAction
{
    /** @param array<string, mixed> $data */
    public function update(Expense $expense, array $data): Expense
    {
        return DB::transaction(function () use ($expense, $data): Expense {
            $this->assertAmendable($expense);

            $expense->fill($data)->save();

            $movement = $expense->cash_movement_id !== null
                ? CashMovement::query()->whereKey($expense->cash_movement_id)->first()
                : null;

            $stillCash = ($data['payment_method'] ?? $expense->payment_method) === 'cash';

            if ($movement !== null && ! $stillCash) {
                // Re-marked as paid by card or bank: the cash never left the
                // till, so the drawer entry has to go with it.
                $movement->delete();
                $expense->forceFill(['cash_movement_id' => null])->save();
            } elseif ($movement !== null) {
                $movement->update([
                    'amount' => (float) $expense->amount,
                    'reason' => $expense->description,
                ]);
            }

            return $expense->load(['category:id,name', 'supplier:id,name']);
        });
    }

    public function delete(Expense $expense): void
    {
        DB::transaction(function () use ($expense): void {
            $this->assertAmendable($expense);

            if ($expense->cash_movement_id !== null) {
                CashMovement::query()->whereKey($expense->cash_movement_id)->delete();
            }

            $expense->delete();
        });
    }

    private function assertAmendable(Expense $expense): void
    {
        if ($expense->isSettledInAClosedShift()) {
            throw DomainException::conflict(
                'This was paid out of a shift that has already been counted and closed. Record a correcting entry instead — changing it now would rewrite a variance somebody signed off.',
                'EXPENSE_SETTLED',
            );
        }
    }
}
