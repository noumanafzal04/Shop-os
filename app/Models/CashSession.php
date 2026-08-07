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
            'is_training' => 'boolean',
        ];
    }

    /**
     * A practice shift. Set once when the shift is opened and never changed —
     * a switch you could flip mid-shift would mix practice and real money in
     * one drawer, which is the mistake the whole feature exists to prevent.
     */
    public function isTraining(): bool
    {
        return (bool) $this->is_training;
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

    /** Every stretch where somebody other than the cashier was ringing on it. */
    public function covers(): HasMany
    {
        return $this->hasMany(CashSessionCover::class)->orderBy('started_at');
    }

    /**
     * Who is standing here instead of the cashier right now, if anyone.
     *
     * Deliberately derived rather than kept as a pointer on the shift: one fact
     * in one place cannot go stale against itself, and this is read on the path
     * of every sale a reliever rings.
     */
    public function activeCover(): ?CashSessionCover
    {
        return $this->covers()->whereNull('ended_at')->latest('started_at')->first();
    }

    public function isOpen(): bool
    {
        return $this->status === 'open';
    }
}
