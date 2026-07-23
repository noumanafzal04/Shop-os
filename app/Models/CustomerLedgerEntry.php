<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One line of a customer's khata (credit ledger): a `charge` from a
 * credit sale (+owed) or a `payment` / `adjustment` (−owed). `balance_after`
 * snapshots the running balance so a statement never has to be recomputed.
 * Append-only — extends Model directly (like SalePayment / StockMovement),
 * so no soft-deletes or updated_by.
 */
class CustomerLedgerEntry extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'balance_after' => 'decimal:2',
        ];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }
}
