<?php

namespace App\Models;

use App\Exceptions\DomainException;
use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A tenant's CRM record for someone who buys from them. Auto-captured from
 * sales/orders by phone, and manually editable (notes/address). Also carries
 * the khata (sell-on-credit) balance + its ledger.
 */
class Customer extends BaseModel
{
    use Auditable;
    use BelongsToTenant;

    /**
     * A credit limit is a MONEY AUTHORITY, not a detail. It decides how much
     * this person may walk out with unpaid, which is the same class of act as
     * granting somebody a permission — and permissions have always been
     * recorded. Nothing else about a customer is: a phone number corrected at
     * the counter is not an event, and auditing the whole record would bury
     * the one line that matters.
     *
     * @return string[]
     */
    protected function auditOnly(): array
    {
        return ['credit_limit'];
    }

    protected function casts(): array
    {
        return [
            'last_seen_at' => 'datetime',
            'credit_balance' => 'decimal:2',
            'credit_limit' => 'decimal:2',
            'loyalty_points' => 'integer',
        ];
    }

    public function sales(): HasMany
    {
        return $this->hasMany(Sale::class);
    }

    /** The pricing/discount tier this customer belongs to, if any. */
    public function group(): BelongsTo
    {
        return $this->belongsTo(CustomerGroup::class, 'customer_group_id');
    }

    public function ledgerEntries(): HasMany
    {
        return $this->hasMany(CustomerLedgerEntry::class)->latest();
    }

    public function loyaltyEntries(): HasMany
    {
        return $this->hasMany(LoyaltyEntry::class)->latest();
    }

    // ── Loyalty points ────────────────────────────────────────────────
    // Mirror of the khata ledger: a running balance + append-only entries,
    // so returns/cancels reverse symmetrically and can never over-reverse.

    /** Earn points on a completed sale (+balance). */
    public function earnPoints(int $points, ?string $saleId, ?string $note = null): ?LoyaltyEntry
    {
        return $points > 0 ? $this->postLoyalty('earn', $points, $points, $saleId, $note) : null;
    }

    /** Redeem points at the counter (−balance). Caller has already validated the balance. */
    public function redeemPoints(int $points, ?string $saleId, ?string $note = null): ?LoyaltyEntry
    {
        return $points > 0 ? $this->postLoyalty('redeem', $points, -$points, $saleId, $note) : null;
    }

    /** Claw back earned points on a return/cancel (−balance). */
    public function reverseEarnedPoints(int $points, ?string $saleId, ?string $note = null): ?LoyaltyEntry
    {
        return $points > 0 ? $this->postLoyalty('reverse_earn', $points, -$points, $saleId, $note) : null;
    }

    /** Give back redeemed points on a return/cancel (+balance). */
    public function refundRedeemedPoints(int $points, ?string $saleId, ?string $note = null): ?LoyaltyEntry
    {
        return $points > 0 ? $this->postLoyalty('reverse_redeem', $points, $points, $saleId, $note) : null;
    }

    /** Earned points on a sale still eligible to be clawed back (earned − already reversed). */
    public function loyaltyEarnedReversible(string $saleId): int
    {
        $earned = (int) $this->loyaltyEntries()->where('sale_id', $saleId)->where('type', 'earn')->sum('points');
        $reversed = (int) $this->loyaltyEntries()->where('sale_id', $saleId)->where('type', 'reverse_earn')->sum('points');

        return max(0, $earned - $reversed);
    }

    /** Redeemed points on a sale still eligible to be refunded (redeemed − already refunded). */
    public function loyaltyRedeemedReversible(string $saleId): int
    {
        $redeemed = (int) $this->loyaltyEntries()->where('sale_id', $saleId)->where('type', 'redeem')->sum('points');
        $refunded = (int) $this->loyaltyEntries()->where('sale_id', $saleId)->where('type', 'reverse_redeem')->sum('points');

        return max(0, $redeemed - $refunded);
    }

    /** Apply a signed delta to the balance and append the ledger entry. */
    private function postLoyalty(string $type, int $points, int $delta, ?string $saleId, ?string $note): LoyaltyEntry
    {
        // Balance never goes negative — clawback can't take points already spent.
        $newBalance = max(0, (int) $this->loyalty_points + $delta);
        $this->forceFill(['loyalty_points' => $newBalance])->save();

        return $this->loyaltyEntries()->create([
            'tenant_id' => $this->tenant_id,
            'type' => $type,
            'points' => $points,
            'balance_after' => $newBalance,
            'sale_id' => $saleId,
            'note' => $note,
            'created_by' => auth()->id(),
        ]);
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
