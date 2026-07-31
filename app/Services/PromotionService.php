<?php

namespace App\Services;

use App\Models\Product;
use App\Models\Promotion;
use Illuminate\Support\Carbon;

/**
 * Evaluates automatic promotions against a cart. `best()` runs inside the sale
 * transaction (server-authoritative); `preview()` is a read-only estimate the
 * POS shows live. A promotion applies only when it's live at the given moment
 * (date range + days-of-week + time window) and its scope matches the cart.
 */
class PromotionService
{
    /**
     * The single best live promotion for a cart, or null. $lines: array of
     * ['product' => Product, 'quantity' => float, 'line_total' => float].
     * $now MUST be in the shop's timezone.
     *
     * @param  array<int, array{product: Product, quantity: float, line_total: float}>  $lines
     * @return array{promotion: Promotion, discount: float}|null
     */
    public function best(array $lines, float $subtotal, Carbon $now): ?array
    {
        $best = null;
        foreach (Promotion::query()->where('is_active', true)->get() as $promo) {
            if (! $this->liveNow($promo, $now)) {
                continue;
            }
            $discount = $this->discountFor($promo, $lines, $subtotal);
            if ($discount <= 0) {
                continue;
            }
            if ($best === null || $discount > $best['discount'] + 0.001) {
                $best = ['promotion' => $promo, 'discount' => $discount];
            } elseif (abs($discount - $best['discount']) <= 0.001 && $promo->priority > $best['promotion']->priority) {
                $best = ['promotion' => $promo, 'discount' => $discount];
            }
        }

        return $best;
    }

    /** Is the promotion live at $now — date range, day-of-week, and time window? */
    public function liveNow(Promotion $promo, Carbon $now): bool
    {
        $today = $now->copy()->startOfDay();
        if ($promo->starts_on !== null && $today->lt($promo->starts_on->copy()->startOfDay())) {
            return false;
        }
        if ($promo->ends_on !== null && $today->gt($promo->ends_on->copy()->startOfDay())) {
            return false;
        }
        $days = $promo->days_of_week ?? [];
        if (! empty($days) && ! in_array((int) $now->dayOfWeek, array_map('intval', $days), true)) {
            return false;
        }
        if ($promo->start_time !== null && $promo->end_time !== null) {
            $t = $now->format('H:i:s');
            $from = $this->hms((string) $promo->start_time);
            $to = $this->hms((string) $promo->end_time);
            // A window that wraps midnight (22:00–02:00) is handled.
            $inWindow = $from <= $to ? ($t >= $from && $t <= $to) : ($t >= $from || $t <= $to);
            if (! $inWindow) {
                return false;
            }
        }

        return true;
    }

    private function hms(string $t): string
    {
        return strlen($t) === 5 ? $t.':00' : $t;
    }

    /** The discount this promotion yields for the cart (0 if it doesn't apply). */
    private function discountFor(Promotion $promo, array $lines, float $subtotal): float
    {
        if ($promo->type === 'bogo') {
            return $this->bogoDiscount($promo, $lines);
        }

        if ($promo->scope === 'order') {
            if ($promo->min_spend !== null && $subtotal < (float) $promo->min_spend) {
                return 0.0;
            }
            $base = $subtotal;
        } else {
            $matching = array_filter($lines, fn ($l) => $this->matches($promo, $l['product']));
            if (empty($matching)) {
                return 0.0;
            }
            $qty = array_sum(array_map(fn ($l) => (float) $l['quantity'], $matching));
            if ($promo->min_qty !== null && $qty < (float) $promo->min_qty) {
                return 0.0;
            }
            $base = array_sum(array_map(fn ($l) => (float) $l['line_total'], $matching));
        }

        if ($base <= 0) {
            return 0.0;
        }

        $discount = $promo->type === 'percent'
            ? $base * ((float) $promo->value / 100)
            : (float) $promo->value;

        if ($promo->type === 'percent' && $promo->max_discount !== null) {
            $discount = min($discount, (float) $promo->max_discount);
        }

        // Never discount more than the base the promotion applies to.
        return round(max(0, min($discount, $base)), 2);
    }

    /**
     * Buy-X-get-Y. For every (buy_qty + get_qty) matching units in the cart,
     * get_qty of the CHEAPEST matching units come off at get_discount_pct
     * (null/100 = free, 50 = half off). Whole units only — a fractional
     * (weight-sold) quantity contributes only its whole part. Per-unit price is
     * the line's effective rate (line_total ÷ quantity), so any per-line
     * discount already flows through and is never double-counted.
     */
    private function bogoDiscount(Promotion $promo, array $lines): float
    {
        $matching = $promo->scope === 'order'
            ? $lines
            : array_filter($lines, fn ($l) => $this->matches($promo, $l['product']));
        if (empty($matching)) {
            return 0.0;
        }

        $buy = max(1, (int) round((float) ($promo->buy_qty ?? 1)));
        $get = max(1, (int) round((float) ($promo->get_qty ?? 1)));
        $pct = $promo->get_discount_pct !== null ? (float) $promo->get_discount_pct : 100.0;
        $groupSize = $buy + $get;

        // Explode matching lines into individual whole units, each at its
        // effective per-unit price, so the cheapest can be given away first.
        $prices = [];
        foreach ($matching as $l) {
            $qty = (float) $l['quantity'];
            $whole = (int) floor($qty);
            if ($whole <= 0 || $qty <= 0) {
                continue;
            }
            $unit = (float) $l['line_total'] / $qty;
            for ($i = 0; $i < $whole; $i++) {
                $prices[] = $unit;
            }
        }

        $freeUnits = intdiv(count($prices), $groupSize) * $get;
        if ($freeUnits <= 0) {
            return 0.0;
        }

        sort($prices); // cheapest first — the standard "cheapest one free"
        $discount = 0.0;
        for ($i = 0; $i < $freeUnits; $i++) {
            $discount += $prices[$i];
        }

        return round(max(0.0, $discount * $pct / 100), 2);
    }

    /** Does a line's product fall in the promotion's category/product scope? */
    private function matches(Promotion $promo, Product $product): bool
    {
        return $promo->scope === 'category'
            ? $product->category_id === $promo->category_id
            : in_array($product->id, $promo->product_ids ?? [], true);
    }

    /**
     * Read-only preview for the POS: best promotion for a cart of
     * {product_id, variant_id?, quantity}, server-priced (selling price × qty)
     * so it trusts no client price. The sale re-evaluates authoritatively.
     *
     * @return array{promotion_id: string, name: string, discount: float}|null
     */
    public function preview(array $items, ?string $timezone): ?array
    {
        $lines = [];
        $subtotal = 0.0;
        foreach ($items as $item) {
            $product = Product::query()->whereKey($item['product_id'] ?? null)->first();
            if ($product === null || (float) ($item['quantity'] ?? 0) <= 0) {
                continue;
            }
            $qty = (float) $item['quantity'];
            $unit = $product->sellingPrice();
            if (! empty($item['variant_id'])) {
                $variant = $product->variants()->whereKey($item['variant_id'])->first();
                if ($variant !== null) {
                    $unit = (float) $variant->price;
                }
            }
            $lineTotal = round($unit * $qty, 2);
            $subtotal = round($subtotal + $lineTotal, 2);
            $lines[] = ['product' => $product, 'quantity' => $qty, 'line_total' => $lineTotal];
        }

        if (empty($lines)) {
            return null;
        }

        $best = $this->best($lines, $subtotal, now()->setTimezone($timezone ?: 'Asia/Karachi'));

        return $best === null ? null : [
            'promotion_id' => $best['promotion']->id,
            'name' => $best['promotion']->name,
            'discount' => $best['discount'],
        ];
    }
}
