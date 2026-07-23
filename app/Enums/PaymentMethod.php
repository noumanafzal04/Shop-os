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
    // Summary marker on a sale paid with more than one method — the per-tender
    // breakdown lives in sale_payments. Never a valid single tender from a client.
    case Split = 'split';
}
