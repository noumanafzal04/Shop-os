<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A cashier's POS shift. One open session per user at a time; closing
 * reconciles counted cash against expected (opening float + cash sales).
 */
class CashSession extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'opening_float' => 'decimal:2',
            'cash_sales' => 'decimal:2',
            'expected_cash' => 'decimal:2',
            'counted_cash' => 'decimal:2',
            'variance' => 'decimal:2',
            'sales_count' => 'integer',
            'sales_total' => 'decimal:2',
            'opened_at' => 'datetime',
            'closed_at' => 'datetime',
            // {"5000": 3, "1000": 12, …} — what was physically in the drawer.
            'opening_denominations' => 'array',
            'closing_denominations' => 'array',
            // What the cashier said each non-cash tender took, and how far that
            // was from what the POS rang.
            'declared_tenders' => 'array',
            'tender_variances' => 'array',
            'blind_close' => 'boolean',
        ];
    }

    public function businessDay(): BelongsTo
    {
        return $this->belongsTo(BusinessDay::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** The lane this shift is running on — null on a single-counter shop. */
    public function register(): BelongsTo
    {
        return $this->belongsTo(Register::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function sales(): HasMany
    {
        return $this->hasMany(Sale::class);
    }

    public function isOpen(): bool
    {
        return $this->status === 'open';
    }
}
