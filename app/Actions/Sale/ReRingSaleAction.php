<?php

namespace App\Actions\Sale;

use App\Actions\Pos\RecordCashMovementAction;
use App\Exceptions\DomainException;
use App\Models\CashSession;
use App\Models\Sale;
use Illuminate\Support\Facades\DB;

/**
 * RE-RING A BILL (Q19 B, the client 2026-10-17).
 *
 * "The bill is printed and they want it changed": the old bill is voided as
 * replaced, the new one is rung, and what the customer already paid is
 * carried onto the new bill — the same way they paid it — so only the
 * difference crosses the counter. One transaction: if the new bill cannot be
 * rung, the old one stands as it was.
 *
 * Only a plain bill, the same shop-day, with nothing done against it since:
 * no return, no trade-in, no bank's share, no points spent, no advance or
 * instalments, no exchange, nothing added to it. Each of those is money or
 * goods some other record already points at, and re-ringing over it would
 * leave that record pointing at a cancelled bill.
 *
 * The drawer. The old bill's notes are already in a drawer and stay there
 * (a cancelled sale's tender still counts — DrawerMath). The new bill takes
 * the same notes as its own cash tender, so the drawer it is rung on records
 * them handed back from the old bill (`void_refund`, named for the re-ring)
 * and taken again: net nothing, then the difference.
 */
class ReRingSaleAction
{
    /** How a carried tender is written on the new bill. */
    public const CARRIED_REFERENCE = 'Carried from ';

    public function __construct(
        private readonly CancelSaleAction $cancel,
        private readonly CreateSaleAction $create,
    ) {}

    /**
     * @param  array<string, mixed>  $data  the new bill, as the till sends any sale — its
     *                                      payments are the DIFFERENCE only
     * @return array{old: Sale, new: Sale}
     */
    public function execute(Sale $old, array $data): array
    {
        self::assertPlain($old);

        return DB::transaction(function () use ($old, $data): array {
            $carried = self::carried($old);

            // The old bill first: it gives its stock back, so the new one can
            // take the same last unit.
            $this->cancel->execute($old, 'Re-rung — replaced by a new bill', Sale::REASON_RE_RUNG, carried: true);

            $tenders = [
                ...array_map(fn (array $t) => $t + ['reference' => self::CARRIED_REFERENCE.$old->invoice_number], $carried),
                ...($data['payments'] ?? (isset($data['payment_method']) && (float) ($data['amount_paid'] ?? 0) > 0
                    ? [['method' => $data['payment_method'], 'amount' => (float) $data['amount_paid']]]
                    : [])),
            ];
            unset($data['payment_method'], $data['amount_paid']);

            $new = $this->create->execute([
                ...$data,
                // One customer: the old bill's, when the counter named none.
                'customer_name' => $data['customer_name'] ?? $old->customer_name,
                'customer_phone' => $data['customer_phone'] ?? $old->customer_phone,
                // Still part of the visit it was part of.
                'adds_to_sale_id' => $data['adds_to_sale_id'] ?? $old->adds_to_sale_id,
                'payments' => $tenders,
            ]);

            // The same notes, handed back from the old bill and taken again by
            // the new one, on the drawer the new one was rung on.
            $cash = round((float) collect($carried)->where('method', 'cash')->sum('amount'), 2);
            $drawer = $new->cash_session_id === null ? null : CashSession::query()->find($new->cash_session_id);
            if ($cash > 0 && $drawer !== null) {
                app(RecordCashMovementAction::class)->execute(auth()->user(), [
                    'type' => 'void_refund',
                    'amount' => $cash,
                    'reason' => "Re-rung {$old->invoice_number} as {$new->invoice_number} — the same notes",
                    'source_type' => 'sale',
                    'source_id' => $old->id,
                ], $drawer, enforceDrawerLimit: false);
            }

            $old->forceFill(['cancel_reason' => "Re-rung as {$new->invoice_number}"])->save();

            return ['old' => $old->fresh(), 'new' => $new];
        });
    }

    /** What was paid, the way it was paid — cash net of the change it gave. */
    public static function carried(Sale $sale): array
    {
        $out = [];
        foreach ($sale->payments()->get() as $payment) {
            $out[$payment->method] = round(($out[$payment->method] ?? 0) + (float) $payment->amount, 2);
        }
        if (isset($out['cash'])) {
            $out['cash'] = round($out['cash'] - (float) $sale->change_due, 2);
        }

        return collect($out)->filter(fn ($amount) => $amount > 0)
            ->map(fn ($amount, $method) => ['method' => $method, 'amount' => $amount])->values()->all();
    }

    /**
     * A plain bill, or a refusal that says what is in the way.
     *
     * Every one of these is a record that points at the bill — a return, a
     * dead battery taken in part-payment, the bank's share, points spent, an
     * advance or a plan it settled, an order or a tab it closed, a refused
     * offline slip it stands for, bills added to it. Cancelling the bill under
     * them would leave each pointing at a bill that is not there.
     */
    public static function assertPlain(Sale $sale): void
    {
        if ($sale->isCancelled()) {
            throw DomainException::conflict('This bill is already cancelled.', 'SALE_ALREADY_CANCELLED');
        }

        $why = match (true) {
            $sale->returns()->exists() => 'items were already returned from it',
            $sale->tradeIns()->exists() => 'goods were taken in part-payment on it',
            $sale->bank_card_offer_id !== null => "a bank's offer paid part of it",
            (int) $sale->points_redeemed > 0 => 'points were spent on it',
            (float) ($sale->exchange_credit ?? 0) > 0 => 'it is the new half of an exchange',
            $sale->payments()->where('method', 'deposit')->exists() => 'it settled an advance',
            Sale::withTraining()->where('adds_to_sale_id', $sale->id)->exists() => 'bills were added to it',
            DB::table('installment_plans')->where('sale_id', $sale->id)->exists() => 'it is on instalments',
            DB::table('sale_documents')->where('sale_id', $sale->id)->exists() => 'it billed a quotation or an advance',
            DB::table('orders')->where('sale_id', $sale->id)->exists() => 'it closed an order',
            DB::table('restaurant_tickets')->where('sale_id', $sale->id)->exists() => "it closed a table's tab",
            DB::table('reservations')->where('sale_id', $sale->id)->exists() => 'it closed a reservation',
            DB::table('offline_refusals')->where('sale_id', $sale->id)->exists() => 'it stands for a refused offline slip',
            default => null,
        };

        if ($why !== null) {
            throw DomainException::conflict(
                "{$sale->invoice_number} can't be re-rung — {$why}. Add the extra items to it, or take items back with Return / Refund.",
                'RERING_NOT_PLAIN',
            );
        }
    }
}
