<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Cash physically taken to the bank.
 *
 * Deliberately NOT a drawer movement. By the time money reaches a bank it left
 * the till hours earlier as a safe drop, and recording it against a drawer
 * again would take the same rupees out twice. What this records is the leg
 * nothing else covers: safe → bank, with the slip number that makes it
 * provable.
 */
class BankDeposit extends BaseModel
{
    use Auditable, BelongsToTenant;

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'deposited_at' => 'datetime',
        ];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function businessDay(): BelongsTo
    {
        return $this->belongsTo(BusinessDay::class);
    }

    public function depositedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'deposited_by');
    }
}
