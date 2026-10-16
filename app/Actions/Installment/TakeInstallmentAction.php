<?php

namespace App\Actions\Installment;

use App\Actions\Customer\TakeKhataPaymentAction;
use App\Exceptions\DomainException;
use App\Models\Customer;
use App\Models\CustomerLedgerEntry;
use App\Models\InstallmentPlan;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * AN INSTALLMENT PAID (F1).
 *
 * A khata payment against the plan's sale — so the customer's khata, the
 * plan and a later return of the goods all read the same rows — taken the way
 * every khata payment is taken (cash into the taker's drawer, today's shift
 * where the shop asks for one). It fills the oldest month first.
 *
 * Paying more than is left is refused, never banked: the plan is a promise of
 * so much, and money beyond it belongs on the customer's khata as an advance,
 * which their card takes and asks about first.
 */
class TakeInstallmentAction
{
    public function __construct(private readonly TakeKhataPaymentAction $payments) {}

    /** @param  array{amount: float|int|string, method: string, reference?: ?string, note?: ?string}  $data */
    public function execute(InstallmentPlan $plan, User $user, array $data): CustomerLedgerEntry
    {
        return DB::transaction(function () use ($plan, $user, $data): CustomerLedgerEntry {
            /** @var InstallmentPlan $locked */
            $locked = InstallmentPlan::query()->whereKey($plan->id)->lockForUpdate()->firstOrFail();

            if (! $locked->isRunning()) {
                throw DomainException::conflict(
                    $locked->status === InstallmentPlan::STATUS_PAID_OFF
                        ? "{$locked->number} is paid off — nothing more is due."
                        : "{$locked->number} is closed — nothing more is due.",
                    'PLAN_NOT_RUNNING',
                );
            }

            $amount = round((float) $data['amount'], 2);
            $left = $locked->schedule()['left'];
            if ($amount > $left + 0.004) {
                throw DomainException::unprocessable(
                    'Only '.number_format($left, 2)." is left on {$locked->number}.",
                    'INSTALLMENT_EXCEEDS_LEFT',
                );
            }

            /** @var Customer $customer */
            $customer = Customer::query()->findOrFail($locked->customer_id);

            return $this->payments->execute(
                $customer,
                $user,
                $amount,
                $data['method'],
                $data['reference'] ?? null,
                $data['note'] ?? "Installment · {$locked->number}",
                $locked->sale_id,
                "Installment {$locked->number}",
            );
        });
    }
}
