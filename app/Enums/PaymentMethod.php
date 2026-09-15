<?php

namespace App\Enums;

enum PaymentMethod: string
{
    case Cash = 'cash';
    case Card = 'card';
    case BankTransfer = 'bank_transfer';
    case Other = 'other';
    // A mobile-money wallet — JazzCash, Easypaisa, SadaPay, a Raast transfer
    // the cashier reads off their own phone.
    //
    // RECORDED, never captured: CartZe has no gateway, so this is the same kind
    // of tender as `card` — the money is confirmed at the counter, it settles
    // nowhere else, and nothing about it is shared with another till. That is
    // why it is offline-safe (see OfflinePolicy::TENDERS).
    //
    // It needs its own case because it had nowhere to go: shops rang it as
    // `other`, or as `bank_transfer` (whose own POS label had quietly drifted to
    // "Bank / wallet"). Either way the day's take gave no answer to the one
    // question a shop actually asks at closing — how much came through the
    // wallet — which is the figure they reconcile against the wallet app.
    case Wallet = 'wallet';
    // Sell-on-credit (khata): the tender that goes ONTO the customer's running
    // balance instead of being received now. Requires a linked customer.
    case Credit = 'credit';
    // Money already received against a layaway, applied when the goods are
    // finally collected. It is NOT cash arriving now — the rupees went into a
    // drawer weeks ago and were counted there — so the drawer expectation must
    // never see it twice. Never a valid tender from a client; only
    // ConvertSaleDocumentAction writes it.
    case Deposit = 'deposit';
    // Part of the bill settled in GOODS — the old battery, the worn tyres.
    // Never a valid tender from a client: the allowance is derived by the
    // server from the trade-in lines, because a client that could name its own
    // trade_in amount could settle any bill without anything crossing the
    // counter. See CreateSaleAction.
    case TradeIn = 'trade_in';
    // Summary marker on a sale paid with more than one method — the per-tender
    // breakdown lives in sale_payments. Never a valid single tender from a client.
    case Split = 'split';

    /**
     * Tenders a client may name for money crossing the counter NOW.
     *
     * Written here because it was written NINE times — `in:cash,card,bank_transfer,other`
     * in seven request classes and two model constants — and a list copied nine
     * times is a list that is wrong in at least one of them the first time it
     * changes. Adding `wallet` was that change.
     *
     * Everything absent is absent for a reason that is not caution:
     * `credit` moves a shared balance (see `counterOrCredit()` for the doors
     * that may), `deposit` is money counted into a drawer weeks ago, `trade_in`
     * is derived by the server from the goods coming back, and `split` is a
     * summary marker rather than a tender.
     *
     * @return list<string>
     */
    public static function counter(): array
    {
        return [
            self::Cash->value,
            self::Card->value,
            self::BankTransfer->value,
            self::Wallet->value,
            self::Other->value,
        ];
    }

    /** …and khata, for the doors that may put a bill on a customer's balance.
     *
     * @return list<string>
     */
    public static function counterOrCredit(): array
    {
        return [...self::counter(), self::Credit->value];
    }
}
