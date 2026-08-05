<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One non-sale cash event against a drawer (see the cash_movements migration).
 *
 * The vocabulary is the counter's, not accounting's — a cashier recognises
 * "safe drop" and "petty cash", not "credit to undeposited funds".
 */
class CashMovement extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    /** Cashier-initiated types (what the POS offers as buttons). */
    public const MANUAL_TYPES = ['paid_in', 'paid_out', 'drop', 'float_add', 'no_sale'];

    /** System-recorded types — written by the flow that moved the money. */
    public const SYSTEM_TYPES = [
        'khata_in', 'supplier_out', 'expense_out', 'void_refund',
        // A layaway advance is real cash in the drawer the moment it is handed
        // over, even though no sale has happened — without this line every
        // advance would be reported as an overage at close.
        'deposit_in', 'deposit_out',
    ];

    /** Which way each type moves the drawer. The single source of that truth. */
    public const DIRECTIONS = [
        'paid_in' => 'in',
        'float_add' => 'in',
        'khata_in' => 'in',
        'deposit_in' => 'in',
        'paid_out' => 'out',
        'drop' => 'out',
        'supplier_out' => 'out',
        'expense_out' => 'out',
        'void_refund' => 'out',
        'deposit_out' => 'out',
        // Opening the drawer is an event, not an amount.
        'no_sale' => 'none',
    ];

    protected function casts(): array
    {
        return ['amount' => 'decimal:2'];
    }

    public static function directionFor(string $type): string
    {
        return self::DIRECTIONS[$type] ?? 'none';
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(CashSession::class, 'cash_session_id');
    }

    public function register(): BelongsTo
    {
        return $this->belongsTo(Register::class);
    }

    /** Signed effect on the drawer: +in, −out, 0 for a no-sale. */
    public function signedAmount(): float
    {
        return match ($this->direction) {
            'in' => (float) $this->amount,
            'out' => -(float) $this->amount,
            default => 0.0,
        };
    }
}
