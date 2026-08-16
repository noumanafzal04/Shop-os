<?php

namespace App\Actions\SaleDocument;

use App\Actions\Pos\RecordCashMovementAction;
use App\Exceptions\DomainException;
use App\Models\SaleDocument;
use App\Models\SaleDocumentPayment;
use Illuminate\Support\Facades\DB;

/**
 * One instalment against a layaway — the opening advance and every "Rs 5,000 aur
 * de kar gaya" after it.
 *
 * The two things that make this more than an INSERT:
 *
 *  - CASH LANDS IN A DRAWER. The rupees are physically in the till the moment
 *    they're handed over, even though no sale happened, so a `deposit_in` cash
 *    movement goes against the cashier's open shift. Without it, every advance
 *    reads as an overage when the drawer is counted — and a drawer whose
 *    variance is routinely wrong is a drawer nobody investigates.
 *
 *  - YOU CANNOT OVERPAY A LAYAWAY. Taking more than the balance would leave the
 *    shop owing change on money it hasn't earned, from a shift that may close
 *    before the customer returns. The balance is re-read under a row lock, so
 *    two counters taking the last instalment at once can't both succeed.
 */
class RecordDepositAction
{
    public function __construct(private readonly RecordCashMovementAction $cash) {}

    /**
     * @param  array{amount: float|int|string, method?: string, reference?: ?string, note?: ?string}  $data
     */
    public function execute(SaleDocument $document, array $data): SaleDocumentPayment
    {
        return DB::transaction(function () use ($document, $data): SaleDocumentPayment {
            /** @var SaleDocument $locked */
            $locked = SaleDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();

            // A layaway takes instalments, and so does a JOB CARD: a workshop
            // asks for money up front because it is about to order parts, and
            // the customer pays the rest when they collect the car. Same
            // machinery, same guards, same ledger.
            //
            // A quotation still takes nothing. It is a price, not an
            // arrangement — there is no agreement to pay against yet.
            if (! $locked->isLayaway() && ! $locked->isJobCard()) {
                throw DomainException::unprocessable(
                    'Only goods held on advance take instalments — a quotation is just a price.',
                    'NOT_A_LAYAWAY',
                );
            }

            if (! $locked->isOpen()) {
                throw DomainException::conflict(
                    $locked->status === SaleDocument::STATUS_CONVERTED
                        ? 'These goods have already been collected.'
                        : 'This layaway was cancelled.',
                    'DOCUMENT_NOT_OPEN',
                );
            }

            $amount = round((float) $data['amount'], 2);

            if ($amount <= 0) {
                throw DomainException::unprocessable('Enter an amount greater than zero.', 'AMOUNT_REQUIRED');
            }

            $method = $data['method'] ?? 'cash';

            if (! in_array($method, SaleDocument::DEPOSIT_METHODS, true)) {
                throw DomainException::unprocessable(
                    'An advance has to be money received — it cannot go on the khata.',
                    'INVALID_DEPOSIT_METHOD',
                );
            }

            $balance = $locked->balance();

            if ($amount > $balance + 0.001) {
                $sym = $locked->tenant?->currencySymbol() ?? 'Rs';
                throw DomainException::unprocessable(
                    'Only '.$sym.' '.number_format($balance, 2).' is still owed on this layaway.',
                    'DEPOSIT_EXCEEDS_BALANCE',
                );
            }

            $user = auth()->user();

            // Record the drawer movement FIRST so the payment row can carry the
            // shift the money actually landed in — a two-month layaway must
            // credit its instalments to the shifts that received them, not to
            // whoever happens to be on the till at collection.
            $movement = null;
            if ($method === 'cash' && $user !== null) {
                $movement = $this->cash->record($user, [
                    'type' => 'deposit_in',
                    'amount' => $amount,
                    'reason' => 'Advance · '.$locked->number,
                    'source_type' => 'sale_document',
                    'source_id' => $locked->id,
                ]);
            }

            /** @var SaleDocumentPayment $payment */
            $payment = $locked->payments()->create([
                'tenant_id' => $locked->tenant_id,
                'cash_session_id' => $movement?->cash_session_id,
                'branch_id' => $movement?->branch_id ?? $locked->branch_id,
                'register_id' => $movement?->register_id ?? $locked->register_id,
                'user_id' => $user?->id,
                'method' => $method,
                'amount' => $amount,
                'reference' => $data['reference'] ?? null,
                'note' => $data['note'] ?? null,
                'paid_at' => now(),
            ]);

            $locked->forceFill([
                'deposit_paid' => round((float) $locked->deposit_paid + $amount, 2),
            ])->save();

            return $payment;
        });
    }
}
