<?php

namespace App\Enums;

enum PaymentMethod: string
{
    case Cash = 'cash';
    case Card = 'card';
    case BankTransfer = 'bank_transfer';
    case Other = 'other';
    // Sell-on-credit (khata): the tender that goes ONTO the customer's running
    // balance instead of being received now. Requires a linked customer.
    case Credit = 'credit';
    // Money already received against a layaway, applied when the goods are
    // finally collected. It is NOT cash arriving now — the rupees went into a
    // drawer weeks ago and were counted there — so the drawer expectation must
    // never see it twice. Never a valid tender from a client; only
    // ConvertSaleDocumentAction writes it.
    case Deposit = 'deposit';
    // Summary marker on a sale paid with more than one method — the per-tender
    // breakdown lives in sale_payments. Never a valid single tender from a client.
    case Split = 'split';
}
