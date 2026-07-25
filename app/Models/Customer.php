<?php

namespace App\Models;

use App\Exceptions\DomainException;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A tenant's CRM record for someone who buys from them. Auto-captured from
 * sales/orders by phone, and manually editable (notes/address). Also carries
 * the khata (sell-on-credit) balance + its ledger.
 */
class Customer extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'last_seen_at' => 'datetime',
            'credit_balance' => 'decimal:2',
            'credit_limit' => 'decimal:2',
        ];
    }

    public function sales(): HasMany
    {
        return $this->hasMany(Sale::class);
    }

    public function ledgerEntries(): HasMany
    {
        return $this->hasMany(CustomerLedgerEntry::class)->latest();
    }

    /**
     * Add a credit-sale charge to the khata (+owed). Enforces the credit limit
     * when one is set. Writes a ledger entry with the running balance.
     */
    public function chargeCredit(float $amount, ?string $saleId = null, ?string $note = null): CustomerLedgerEntry
    {
        $amount = round($amount, 2);
        $newBalance = round((float) $this->credit_balance + $amount, 2);

        if ($this->credit_limit !== null && $newBalance > (float) $this->credit_limit + 0.001) {
            throw DomainException::unprocessable(
                'This sale would exceed the customer\'s credit limit ('
                .number_format((float) $this->credit_limit, 2).').',
                'CREDIT_LIMIT_EXCEEDED',
            );
        }

        $this->forceFill(['credit_balance' => $newBalance])->save();

        return $this->ledgerEntries()->create([
            'tenant_id' => $this->tenant_id,
            'type' => 'charge',
            'amount' => $amount,
            'balance_after' => $newBalance,
            'sale_id' => $saleId,
            'note' => $note,
            'created_by' => auth()->id(),
        ]);
    }

    /**
     * Record a repayment against the khata (−owed). Balance can go below zero
     * (an advance / credit in the customer's favour). Pass the sale id when
     * the reduction reverses a specific credit sale (return/cancellation) so
     * the ledger stays traceable per sale.
     */
    public function recordCreditPayment(float $amount, string $method, ?string $reference = null, ?string $note = null, ?string $saleId = null): CustomerLedgerEntry
    {
        $amount = round($amount, 2);
        $newBalance = round((float) $this->credit_balance - $amount, 2);
        $this->forceFill(['credit_balance' => $newBalance])->save();

        return $this->ledgerEntries()->create([
            'tenant_id' => $this->tenant_id,
            'type' => 'payment',
            'amount' => $amount,
            'balance_after' => $newBalance,
            'method' => $method,
            'reference' => $reference,
            'sale_id' => $saleId,
            'note' => $note,
            'created_by' => auth()->id(),
        ]);
    }

    /**
     * How much of a given sale's khata charge is still un-reversed — the cap
     * for any further return/cancellation reversal against that sale.
     */
    public function outstandingCreditForSale(string $saleId): float
    {
        $charged = (float) $this->ledgerEntries()->where('sale_id', $saleId)->where('type', 'charge')->sum('amount');
        $reversed = (float) $this->ledgerEntries()->where('sale_id', $saleId)->where('type', 'payment')->sum('amount');

        return round(max(0, $charged - $reversed), 2);
    }

    /**
     * Upsert a CRM record by (tenant, phone). No phone → skip (can't dedup an
     * anonymous walk-in). Never blanks an existing name/email.
     */
    public static function capture(string $tenantId, ?string $phone, ?string $name, ?string $email = null): ?self
    {
        $phone = trim((string) $phone);
        if ($phone === '') {
            return null;
        }

        $customer = self::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->where('phone', $phone)
            ->first();

        if ($customer !== null) {
            $customer->forceFill(array_filter([
                'name' => $name ?: null,
                'email' => $email ?: null,
            ]) + ['last_seen_at' => now()])->save();

            return $customer;
        }

        return self::withoutTenancy()->create([
            'tenant_id' => $tenantId,
            'phone' => $phone,
            'name' => $name ?: 'Customer',
            'email' => $email ?: null,
            'last_seen_at' => now(),
        ]);
    }
}
