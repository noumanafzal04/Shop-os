<?php

namespace App\Actions\Expense;

use App\Actions\Pos\RecordCashMovementAction;
use App\Models\Expense;
use App\Models\ExpenseBudget;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * File an expense, and move the drawer if that is where the money came from.
 *
 * The whole point of this action is the second half. Before it, a shopkeeper
 * paying the electricity bill out of the till filed a perfect expense record
 * and left the drawer expecting cash that was no longer in it — an unexplained
 * short at close, on the one number a shop uses to detect theft. Two of those a
 * week and the variance report is noise, which is worse than not having one.
 *
 * Three rules the counter imposes on that:
 *
 *  - only CASH touches a drawer. A card or bank payment is real money leaving
 *    the business but not the till, and posting it to the drawer would invent
 *    a short of exactly the amount that was never there.
 *
 *  - the movement goes against the ACTOR's own open shift, or nowhere. The
 *    owner filing last week's bills from the office at midnight has no drawer;
 *    inventing one — or reaching into whichever cashier happens to be open —
 *    would put a stranger's variance on their shift. This mirrors what void
 *    refunds and supplier payouts already do.
 *
 *  - a budget never blocks. The bill arrived; refusing to record it does not
 *    unspend the money, it only means the books stop matching the world. The
 *    ceiling is reported back as a warning at the moment of entry — the only
 *    moment anyone can still act on it.
 */
class RecordExpenseAction
{
    public function __construct(private readonly RecordCashMovementAction $cash) {}

    /**
     * @param  array<string, mixed>  $data
     * @return array{expense: Expense, warnings: array<int, string>}
     */
    public function execute(User $user, array $data): array
    {
        return DB::transaction(function () use ($user, $data): array {
            $paidInCash = ($data['payment_method'] ?? 'cash') === 'cash';

            // Re-read after insert: Eloquent doesn't hydrate columns the caller
            // never set, so a fresh row is the only way the response carries
            // payment_method, cash_movement_id and the rest rather than
            // silently omitting them.
            $expense = Expense::query()->create($data)->fresh();

            if ($paidInCash) {
                // record() returns null when the actor has no open shift —
                // "no drawer, no cash moved through one".
                $movement = $this->cash->record($user, [
                    'type' => 'expense_out',
                    'amount' => (float) $expense->amount,
                    'reason' => $expense->description,
                    'source_type' => 'expense',
                    'source_id' => $expense->id,
                ]);

                if ($movement !== null) {
                    $expense->forceFill(['cash_movement_id' => $movement->id])->save();
                }
            }

            return [
                'expense' => $expense->load(['category:id,name', 'supplier:id,name']),
                'warnings' => $this->warningsFor($expense, $paidInCash),
            ];
        });
    }

    /**
     * What the person entering this needs to hear right now — not later, in a
     * report nobody opens.
     *
     * @return array<int, string>
     */
    private function warningsFor(Expense $expense, bool $paidInCash): array
    {
        $warnings = [];

        // Same category, same amount, same day. Rent CAN legitimately repeat,
        // so this is a nudge, never a refusal.
        $duplicate = Expense::query()
            ->whereKeyNot($expense->id)
            ->where('expense_category_id', $expense->expense_category_id)
            ->where('amount', $expense->amount)
            ->whereDate('expense_date', $expense->expense_date)
            ->exists();

        if ($duplicate) {
            $warnings[] = 'A very similar expense (same category, amount and date) already exists.';
        }

        if ($paidInCash && $expense->cash_movement_id === null) {
            $warnings[] = 'Recorded as cash, but you have no shift open — the drawer was not adjusted.';
        }

        $month = Carbon::parse($expense->expense_date)->startOfMonth();
        $ceiling = ExpenseBudget::ceilingFor($expense->expense_category_id, $month, $expense->branch_id);

        if ($ceiling !== null) {
            $spent = (float) Expense::query()
                ->where('expense_category_id', $expense->expense_category_id)
                ->when($expense->branch_id !== null, fn ($q) => $q->where('branch_id', $expense->branch_id))
                ->whereBetween('expense_date', [$month, $month->copy()->endOfMonth()])
                ->sum('amount');

            if ($spent > $ceiling) {
                $warnings[] = sprintf(
                    '%s is now %s over its %s budget for %s.',
                    $expense->category?->name ?? 'This category',
                    number_format($spent - $ceiling, 2),
                    number_format($ceiling, 2),
                    $month->format('F Y'),
                );
            }
        }

        return $warnings;
    }
}
