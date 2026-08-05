<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One advance handed over against a layaway. Append-only (like SalePayment and
 * StockMovement) — an instalment history a cashier can edit is not a history.
 *
 * `cash_session_id` matters more than it looks: the money landed in ONE
 * particular drawer on ONE particular shift, which is rarely the shift that
 * finally hands the goods over. Without it a two-month layaway would credit
 * its deposits to whoever happened to be on the till at collection.
 */
class SaleDocumentPayment extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'paid_at' => 'datetime',
        ];
    }

    public function document(): BelongsTo
    {
        return $this->belongsTo(SaleDocument::class, 'sale_document_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
