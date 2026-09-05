<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A period's charges, bundled into one bill.
 *
 * The totals are stored rather than summed from the charges on every read.
 * That is not an optimisation: a charge waived AFTER the invoice went out must
 * not silently change a number the shop has already seen and possibly paid.
 */
class CommissionInvoice extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'period_start' => 'date',
            'period_end' => 'date',
            'orders_count' => 'integer',
            'base_total' => 'decimal:2',
            'amount' => 'decimal:2',
            'paid_at' => 'datetime',
        ];
    }

    public function charges(): HasMany
    {
        return $this->hasMany(CommissionCharge::class, 'invoice_id');
    }
}
