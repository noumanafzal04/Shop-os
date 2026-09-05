<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What one online order earned the platform.
 *
 * `rate_percent` and `base_amount` are SNAPSHOTS. See the migration for why
 * neither is ever re-derived.
 */
class CommissionCharge extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'rate_percent' => 'decimal:2',
            'base_amount' => 'decimal:2',
            'amount' => 'decimal:2',
            'waived_at' => 'datetime',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(CommissionInvoice::class, 'invoice_id');
    }

    /** Still owed: not on an invoice, and not written off. */
    public function scopeOutstanding($query)
    {
        return $query->whereNull('invoice_id')->whereNull('waived_at');
    }
}
