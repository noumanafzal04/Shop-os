<?php

namespace App\Services;

use App\Exceptions\DomainException;
use App\Models\Coupon;

/**
 * Coupon validation + application. `validate()` is a read-only preview (POS /
 * checkout show the discount before committing); `apply()` runs inside the
 * sale/order transaction, row-locking the coupon and bumping used_count so
 * usage limits hold under concurrency.
 */
class CouponService
{
    /** @return array{coupon: Coupon, discount: float} */
    public function validate(string $tenantId, string $code, float $subtotal): array
    {
        /** @var Coupon|null $coupon */
        $coupon = Coupon::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereRaw('UPPER(code) = ?', [strtoupper(trim($code))])
            ->first();

        return ['coupon' => $coupon, 'discount' => $this->assess($coupon, $subtotal)];
    }

    /** Validate + consume one use (locked). Returns the discount to apply. */
    public function apply(string $tenantId, string $code, float $subtotal): array
    {
        /** @var Coupon|null $coupon */
        $coupon = Coupon::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereRaw('UPPER(code) = ?', [strtoupper(trim($code))])
            ->lockForUpdate()
            ->first();

        $discount = $this->assess($coupon, $subtotal);

        $coupon->increment('used_count');

        return ['coupon' => $coupon, 'discount' => $discount, 'code' => $coupon->code];
    }

    /** Runs the rules and returns the discount, or throws with a code. */
    private function assess(?Coupon $coupon, float $subtotal): float
    {
        if ($coupon === null || ! $coupon->is_active) {
            throw DomainException::unprocessable('This coupon code is not valid.', 'COUPON_INVALID');
        }
        if ($coupon->starts_at !== null && $coupon->starts_at->isFuture()) {
            throw DomainException::unprocessable('This coupon is not active yet.', 'COUPON_NOT_STARTED');
        }
        if ($coupon->expires_at !== null && $coupon->expires_at->isPast()) {
            throw DomainException::unprocessable('This coupon has expired.', 'COUPON_EXPIRED');
        }
        if ($coupon->min_spend !== null && $subtotal < (float) $coupon->min_spend) {
            throw DomainException::unprocessable('Order is below the minimum spend for this coupon.', 'COUPON_MIN_SPEND');
        }
        if ($coupon->usage_limit !== null && $coupon->used_count >= $coupon->usage_limit) {
            throw DomainException::unprocessable('This coupon has reached its usage limit.', 'COUPON_EXHAUSTED');
        }

        $discount = $coupon->type === 'percent'
            ? $subtotal * ((float) $coupon->value / 100)
            : (float) $coupon->value;

        if ($coupon->type === 'percent' && $coupon->max_discount !== null) {
            $discount = min($discount, (float) $coupon->max_discount);
        }

        // Never discount more than the subtotal.
        return round(min($discount, $subtotal), 2);
    }
}
