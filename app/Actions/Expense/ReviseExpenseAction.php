<?php

namespace App\Actions\Expense;

use App\Actions\Pos\RecordCashMovementAction;
use App\Exceptions\DomainException;
use App\Models\CashMovement;
use App\Models\Expense;
use App\Models\User;
use App\Support\BooksDrawer;
use Illuminate\Support\Facades\DB;

/**
 * Edit or delete an expense, keeping the drawer honest.
 *
 * An expense that moved cash is two records, not one, and they must not drift
 * apart. The rule is the cash book's own, and it turns on whether the shift has
 * been counted:
 *
 *   SHIFT STILL OPEN    the drawer hasn't been counted, so the mistake is
 *                       simply corrected — the movement is amended, removed or
 *                       created alongside the expense.
 *
 *   SHIFT CLOSED        somebody counted that drawer, signed off a variance and
 *                       went home. Rewriting the movement now changes a figure
 *                       that has already been reconciled, and deleting it
 *                       leaves the shift short with no record of why. Refused;
 *                       the fix is a compensating entry, which is how cash
 *                       books have always handled yesterday.
 *
 * All three directions of the method change matter, and only two of them used
 * to work. Cash → card removed the movement, cash → cash amended it, and card →
 * cash did NOTHING: the row said the money came out of the till, the drawer had
 * never heard of it, and the shift closed on a short of exactly that amount —
 * the precise failure this module was built to end, arriving through the
 * correction rather than the entry.
 */
class ReviseExpenseAction
{
    public function __construct(private readonly RecordCashMovementAction $cash) {}

    /**
     * @param  array<string, mixed>  $data
     * @return array{expense: Expense, warnings: array<int, string>}
     */
    public function update(User $user, Expense $expense, array $data): array
    {
        return DB::transaction(function () use ($user, $expense, $data): array {
            $this->assertAmendable($expense);

            $wasCash = $expense->payment_method === 'cash';
            $expense->fill($data)->save();

            $movement = $expense->cash_movement_id !== null
                ? CashMovement::query()->whereKey($expense->cash_movement_id)->first()
                : null;

            $stillCash = ($data['payment_method'] ?? $expense->payment_method) === 'cash';
            $warnings = [];

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
            } elseif ($stillCash && ! $wasCash) {
                // Corrected from card/bank to cash. The money did come out of
                // a drawer, so one has to move — the actor's own, real and
                // open, or none at all: the rule the original entry follows.
                $practice = BooksDrawer::isPractice($user);
                $created = $practice ? null : $this->cash->record($user, [
                    'type' => 'expense_out',
                    'amount' => (float) $expense->amount,
                    'reason' => $expense->description,
                    'source_type' => 'expense',
                    'source_id' => $expense->id,
                ]);

                if ($created !== null) {
                    $expense->forceFill(['cash_movement_id' => $created->id])->save();
                } else {
                    $warnings[] = BooksDrawer::untouchedDrawerWarning($practice, 'Changed to cash');
                }
            }

            return [
                'expense' => $expense->load(['category:id,name', 'supplier:id,name']),
                'warnings' => $warnings,
            ];
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
