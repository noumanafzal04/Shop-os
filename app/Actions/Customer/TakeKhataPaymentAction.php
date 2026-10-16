<?php

namespace App\Actions\Customer;

use App\Actions\Pos\RecordCashMovementAction;
use App\Models\CashSession;
use App\Models\Customer;
use App\Models\CustomerLedgerEntry;
use App\Models\User;
use App\Support\BooksDrawer;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * ONE PAYMENT AGAINST A CUSTOMER'S KHATA — and, in cash, into a drawer.
 *
 * The khata card and an installment plan take money the same way, so they take
 * it here. Cash lands in the open drawer of whoever takes it (`khata_in`); in a
 * shop that asks for shifts it is refused without TODAY's shift, the rule a
 * cash advance already follows (L2). Before this, cash taken with no shift was
 * written to the khata and reached no drawer at all, without a word (L18).
 */
class TakeKhataPaymentAction
{
    public function __construct(
        private readonly RecordCashMovementAction $cash,
        private readonly TenantContext $context,
    ) {}

    public function execute(
        Customer $customer,
        User $user,
        float $amount,
        string $method,
        ?string $reference = null,
        ?string $note = null,
        ?string $saleId = null,
        string $what = 'Khata payment',
    ): CustomerLedgerEntry {
        return DB::transaction(function () use ($customer, $user, $amount, $method, $reference, $note, $saleId, $what): CustomerLedgerEntry {
            if ($method === 'cash') {
                BooksDrawer::mustBeOpenToday(
                    CashSession::query()->where('user_id', $user->id)->where('status', 'open')->value('id'),
                    $this->context->get(),
                    'taking cash',
                );
            }

            // Locked: two counters taking money from one customer at once must
            // not both read the same balance.
            $locked = Customer::query()->whereKey($customer->id)->lockForUpdate()->firstOrFail();
            $entry = $locked->recordCreditPayment($amount, $method, $reference, $note, $saleId);

            if ($method === 'cash') {
                $this->cash->record($user, [
                    'type' => 'khata_in',
                    'amount' => $amount,
                    'reason' => "{$what} · {$locked->name}",
                    'source_type' => 'customer_ledger_entry',
                    'source_id' => $entry->id,
                ]);
            }

            return $entry;
        });
    }
}
