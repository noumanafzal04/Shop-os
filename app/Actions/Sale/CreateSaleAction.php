<?php

namespace App\Actions\Sale;

use App\Enums\ItemType;
use App\Enums\PaymentMethod;
use App\Enums\SaleStatus;
use App\Exceptions\DomainException;
use App\Models\BranchPrice;
use App\Models\CashSession;
use App\Models\Customer;
use App\Models\CustomerVehicle;
use App\Models\Product;
use App\Models\ProductSerial;
use App\Models\ProductUnit;
use App\Models\ProductVariant;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SaleItemSerial;
use App\Services\CouponService;
use App\Services\InventoryService;
use App\Services\PromotionService;
use App\Support\BranchContext;
use App\Support\CashRounding;
use App\Support\ModifierResolver;
use App\Support\Permissions;
use App\Support\RegisterContext;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * The complete sale workflow in ONE transaction:
 *   items → totals → payment check → gap-free invoice number →
 *   stock decrement (through InventoryService, row-locked) → sale row.
 *
 * Edge cases:
 *  - double-click "Complete Sale"  → idempotency_key replays the same sale
 *  - out-of-stock at checkout      → INSUFFICIENT_STOCK, whole sale rolls
 *                                    back (including the invoice number)
 *  - product deleted mid-checkout  → PRODUCT_UNAVAILABLE, rollback
 *  - price/cost changed later      → line snapshots keep sale history true
 *  - underpayment                  → PAYMENT_INSUFFICIENT
 *  - discount > subtotal           → DISCOUNT_EXCEEDS_SUBTOTAL
 */
class CreateSaleAction
{
    public function __construct(
        private readonly InventoryService $inventory,
        private readonly TenantContext $context,
        private readonly CouponService $coupons,
        private readonly BranchContext $branchContext,
        private readonly PromotionService $promotions,
    ) {}

    public function execute(array $data): Sale
    {
        // Replay path — the retry gets the ORIGINAL sale back.
        if (! empty($data['idempotency_key'])) {
            $existing = Sale::query()
                ->where('idempotency_key', $data['idempotency_key'])
                ->first();

            if ($existing !== null) {
                return $existing->load('items');
            }
        }

        try {
            return DB::transaction(function () use ($data): Sale {
                $tenantId = $this->context->id();
                // The branch this sale is rung on — resolved by ResolveBranch from
                // the operator's assignment / selected branch. Stock decrements here
                // and every later return/cancel restock target THIS branch. Null on
                // headless paths → InventoryService falls back to Main.
                $branchId = $this->branchContext->id();

                // Pricing is SERVER-authoritative. A line unit_price + skipping the
                // serving-window check are honored ONLY on the trusted internal
                // path (order/reservation completion replaying an already-placed
                // line) — never from HTTP input, where a unit_price would be a
                // price-override fraud vector. StoreSaleRequest strips unit_price;
                // trusted_prices can only be set by backend callers.
                $trusted = (bool) ($data['trusted_prices'] ?? false);
                $shopTimezone = $this->context->get()?->timezone;

                // The goods already left the shelf, so this sale must not take them
                // again. Exactly one caller sets it: converting a LAYAWAY, whose
                // stock moved out the day the advance was taken (reference_type
                // 'layaway') and is sitting in the back with the customer's name on
                // it. Gated behind `trusted` for the same reason unit_price is —
                // from HTTP it would be a "sell without decrementing" switch.
                $skipStock = $trusted && ! empty($data['skip_stock']);

                // ── Training ────────────────────────────────────────────
                // The shift decides, never the request: a client-supplied
                // "this one is practice" flag is a switch for making real
                // stock and real money disappear. A sale inherits it from the
                // drawer it is rung on, and nothing else can set it.
                $training = ! empty($data['cash_session_id'])
                    && (bool) CashSession::query()
                        ->whereKey($data['cash_session_id'])
                        ->value('is_training');

                // Practice takes nothing off the shelf.
                $skipStock = $skipStock || $training;

                if ($training) {
                    $this->assertTrainable($data);
                }

                // ── Build lines with fresh, locked product data ──────────
                $lines = [];
                $subtotal = 0.0;
                // Hand-keyed line discounts, accumulated for the ceiling check below.
                $discretionaryLineDiscount = 0.0;

                // The shop's default tax rate — each line snapshots its effective
                // rate (tax group, else product rate, else this default) so returns
                // can refund tax.
                $defaultTaxRate = (float) ($this->context->get()?->setting('default_tax_rate', 0) ?? 0);

                // Inclusive vs exclusive tax. Inclusive means the selling price
                // already contains tax — the total is NOT inflated by it and the
                // receipt shows the portion held within. POS/direct only: an online
                // order replays its own settled total (and quotes zero tax anyway),
                // so the trusted path is always treated as exclusive.
                // A trusted caller states the mode it already settled in rather
                // than inheriting today's shop setting: an online order replays an
                // exclusive total (and quotes zero tax anyway), while a layaway
                // priced months ago must be collected in the mode it was quoted in
                // — otherwise an inclusive quote would have its tax added a second
                // time at collection and the customer would be charged more than
                // the paper in their hand says. Defaults to exclusive, which is
                // exactly what every existing trusted caller means.
                $taxInclusive = $trusted
                    ? (bool) ($data['tax_inclusive'] ?? false)
                    : (bool) ($this->context->get()?->setting('tax_inclusive', false));

                // Customer group (tiered pricing): resolve the linked customer's
                // group ONCE, up front. It can pin the default price LEVEL for lines
                // (a trade customer rung at wholesale automatically) and carry an
                // automatic members' DISCOUNT applied at checkout. POS/direct only —
                // an online order replays its own settled total.
                $customerGroup = null;
                if (! $trusted && ! empty($data['customer_phone'])) {
                    $customerGroup = Customer::query()
                        ->where('phone', trim((string) $data['customer_phone']))
                        ->first()?->group;
                }
                $groupPriceLevel = ($customerGroup?->price_level === 'wholesale') ? 'wholesale' : 'retail';

                foreach ($data['items'] as $item) {
                    /** @var Product|null $product */
                    // The trusted path (order/reservation completion, dine-in
                    // settlement) replays a line captured EARLIER — the product may
                    // have been 86'd/deactivated since, but the customer already
                    // committed; deactivation must never block settling their money.
                    $product = Product::query()
                        ->whereKey($item['product_id'])
                        ->when(! $trusted, fn ($q) => $q->where('is_active', true))
                        ->lockForUpdate()
                        ->first();

                    if ($product === null) {
                        throw DomainException::unprocessable(
                            'An item in this sale is no longer available.',
                            'PRODUCT_UNAVAILABLE',
                        );
                    }

                    $variant = null;
                    if (! empty($item['variant_id'])) {
                        $variant = ProductVariant::query()
                            ->whereKey($item['variant_id'])
                            ->where('product_id', $product->id)
                            ->lockForUpdate()
                            ->first();

                        if ($variant === null || (! $trusted && ! $variant->is_active)) {
                            throw DomainException::unprocessable(
                                'A variant in this sale is no longer available.',
                                'VARIANT_UNAVAILABLE',
                            );
                        }
                    }

                    // Food serving window applies at the counter too — don't ring
                    // up a breakfast item at dinner. Skipped for the trusted path
                    // (order/reservation completion) and for dine-in settlement
                    // (skip_serving_window) — a tab item was ordered earlier, when
                    // it WAS in window; the window must not block paying the bill.
                    if (! $trusted && empty($data['skip_serving_window']) && ! $product->isAvailableNow($shopTimezone)) {
                        throw DomainException::unprocessable(
                            "{$product->name} isn't available right now — it's served "
                            .substr((string) $product->available_from, 0, 5).'–'.substr((string) $product->available_until, 0, 5).'.',
                            'ITEM_NOT_AVAILABLE_NOW',
                        );
                    }

                    $source = $variant ?? $product;
                    $quantity = (float) $item['quantity'];

                    // Pack-breaking: a product-level line may be sold in a defined
                    // pack (strip/box). The pack maps to `factor` base units; stock
                    // is drawn in base units, the price is the pack's. Packs don't
                    // combine with variants (variants carry their own price/stock).
                    $unit = null;
                    if ($variant === null && ! empty($item['product_unit_id'])) {
                        $unit = ProductUnit::query()
                            ->whereKey($item['product_unit_id'])
                            ->where('product_id', $product->id)
                            ->first();

                        if ($unit === null) {
                            throw DomainException::unprocessable(
                                'A pack unit in this sale is no longer available.',
                                'UNIT_UNAVAILABLE',
                            );
                        }
                    }
                    $factor = $unit !== null ? (float) $unit->factor : 1.0;

                    // Unit-sold items (a phone, a tin, a strip) can't be sold in
                    // fractions; only weight/volume items (sold_by = weight) take
                    // decimals. Applies to the sold pack count either way.
                    if ($product->sold_by !== 'weight' && fmod($quantity, 1.0) !== 0.0) {
                        throw DomainException::unprocessable(
                            "\"{$product->name}\" is sold by unit — enter a whole quantity.",
                            'FRACTIONAL_QTY_NOT_ALLOWED',
                        );
                    }

                    // Wholesale minimum applies at the counter exactly as online —
                    // the same rule the marketplace enforces (OrderService), so a
                    // walk-in can't undercut the item's minimum order quantity.
                    if (! $trusted && $product->min_order_qty !== null && $quantity < (float) $product->min_order_qty) {
                        throw DomainException::unprocessable(
                            "Minimum order quantity for {$product->name} is {$product->min_order_qty}.",
                            'MIN_ORDER_QTY',
                        );
                    }

                    // Price level (retail | wholesale) — a named price list. It
                    // sets the per-unit RETAIL-or-WHOLESALE rate; packs multiply it,
                    // variants keep their own price. Wholesale falls back to retail
                    // when the item has no wholesale rate. Defaults to the customer
                    // group's level (so a trade customer is wholesale by default),
                    // which an explicit per-line price_level still overrides.
                    $level = ($item['price_level'] ?? $groupPriceLevel) === 'wholesale' ? 'wholesale' : 'retail';
                    $levelUnit = $product->priceForLevel($level, $quantity);

                    // Per-branch price override (Phase 4c): the branch's own retail
                    // price for this product/variant, if set. Effective = override ??
                    // tenant base. Applies to the RETAIL level only (wholesale keeps
                    // the tenant wholesale list) and never on the trusted path, which
                    // carries a price captured earlier. Packs multiply the override.
                    $override = $trusted ? null : $this->branchPrice($branchId, $product->id, $variant?->id);
                    if ($override !== null && $level === 'retail' && $variant === null) {
                        $levelUnit = $override;
                    }

                    $basePrice = $trusted && isset($item['unit_price'])
                        ? (float) $item['unit_price']
                        : ($unit !== null
                            ? $unit->priceUsing($levelUnit)
                            : ($variant !== null
                                ? ($override ?? (float) $variant->price)
                                : $levelUnit));

                    // Food modifiers / add-ons. The POS path validates + prices the
                    // selection here. The trusted path (order/reservation completion)
                    // already validated at placement and baked the delta into the
                    // trusted unit_price, so we carry the captured snapshot forward
                    // as-is — re-running the resolver would double-count the delta
                    // and wrongly reject a required group on completion.
                    if ($trusted) {
                        $modifierDelta = 0.0;
                        $modifierSnapshot = $item['modifiers'] ?? [];
                    } else {
                        [$modifierDelta, $modifierSnapshot] = ModifierResolver::resolve(
                            $product,
                            $item['modifier_option_ids'] ?? [],
                        );
                    }

                    // Serialized retail: clean the captured serials (trim, drop
                    // blanks, keep order). You can't sell more serialed units than
                    // the line quantity (one IMEI per phone). An optional per-line
                    // warranty override beats the product default.
                    $serials = collect($item['serials'] ?? [])
                        ->map(fn ($s) => trim((string) $s))
                        ->filter(fn ($s) => $s !== '')
                        ->unique()
                        ->values()
                        ->all();
                    if (! empty($serials) && count($serials) > $quantity) {
                        throw DomainException::unprocessable(
                            "You entered more serials than units sold for {$product->name}.",
                            'SERIAL_COUNT_EXCEEDS_QTY',
                        );
                    }
                    $warrantyOverride = array_key_exists('warranty_months', $item) && $item['warranty_months'] !== null
                        ? (int) $item['warranty_months']
                        : null;

                    $unitPrice = round($basePrice + $modifierDelta, 2);
                    $gross = round($unitPrice * $quantity, 2);

                    // Per-line discount (POS): computed off the SERVER's own line
                    // price. A percentage wins if given; a fixed amount is clamped
                    // so it can never exceed the line (no negative lines). The
                    // trusted path instead carries the CAPTURED discount forward
                    // for the record (it's already baked into the trusted totals).
                    $lineDiscount = 0.0;
                    if (! $trusted) {
                        if (($pct = (float) ($item['line_discount_pct'] ?? 0)) > 0) {
                            $lineDiscount = round($gross * min($pct, 100) / 100, 2);
                        } elseif (($amt = (float) ($item['line_discount'] ?? 0)) > 0) {
                            $lineDiscount = min(round($amt, 2), $gross);
                        }
                    } else {
                        $lineDiscount = round((float) ($item['line_discount'] ?? 0), 2);
                    }

                    // Hand-keyed line discounts count toward the shop's ceiling; a
                    // trusted replay's captured discount does not (it was already
                    // adjudicated when the tab or order was settled).
                    if (! $trusted) {
                        $discretionaryLineDiscount = round($discretionaryLineDiscount + $lineDiscount, 2);
                    }

                    // Trusted callers may pass the exact captured line_total (a
                    // dine-in tab shows a running total all meal — the settled bill
                    // must equal it to the paisa, immune to per-unit rounding).
                    $lineTotal = $trusted && isset($item['line_total'])
                        ? round((float) $item['line_total'], 2)
                        : round($gross - $lineDiscount, 2);
                    $subtotal = round($subtotal + $lineTotal, 2);

                    $lines[] = [
                        'product' => $product,
                        'variant' => $variant,
                        'unit' => $unit,
                        'factor' => $factor,
                        'quantity' => $quantity,
                        'unit_price' => $unitPrice,
                        // Cost tracks the BASE unit; a pack's cost is base cost × factor.
                        'unit_cost' => $source->cost !== null ? round((float) $source->cost * $factor, 2) : null,
                        'line_discount' => $lineDiscount,
                        'line_total' => $lineTotal,
                        'modifiers' => $modifierSnapshot,
                        'serials' => $serials,
                        'warranty_months' => $warrantyOverride,
                        // Trimmed to null so an empty box does not print a
                        // blank directions line on the label.
                        'directions' => trim((string) ($item['directions'] ?? '')) ?: null,
                        // Effective tax %% snapshot — tax group, else product rate,
                        // else shop default.
                        'tax_rate' => $product->effectiveTaxRate($defaultTaxRate),
                    ];
                }

                // ── Totals & payment ─────────────────────────────────────
                $discount = round((float) ($data['discount'] ?? 0), 2);

                if ($discount > $subtotal) {
                    throw DomainException::unprocessable(
                        'Discount cannot exceed the subtotal.',
                        'DISCOUNT_EXCEEDS_SUBTOTAL',
                    );
                }

                // ── The shop's discount ceiling ──────────────────────────
                // A cashier with discounts.apply could hand out any amount they
                // liked. The owner can now cap DISCRETIONARY generosity — the cart
                // discount plus hand-keyed line discounts — and going past the cap
                // needs discounts.override (a manager). Coupons, promotions, group
                // pricing and loyalty are deliberately excluded: those are rules the
                // owner configured, not a judgement call at the counter.
                //
                // Skipped on the trusted path: an online order or dine-in tab is
                // replaying a total that was already settled, and re-adjudicating
                // it here would refuse to complete a sale the customer has paid.
                if (! $trusted) {
                    $this->assertWithinDiscountCeiling($discount + $discretionaryLineDiscount, $subtotal);
                }

                // Coupon: validate + consume, add its discount (clamped to subtotal).
                $couponCode = null;
                if (! empty($data['coupon_code'])) {
                    $result = $this->coupons->apply($tenantId, $data['coupon_code'], $subtotal);
                    $discount = round(min($discount + $result['discount'], $subtotal), 2);
                    $couponCode = $result['code'];
                }

                // ── Promotions (automatic, scheduled) ────────────────────
                // The best live promotion for this cart — applied as a discount and
                // stamped on the sale for attribution. POS/direct only: an online
                // order / reservation replays its own settled total on the trusted
                // path. Evaluated BEFORE loyalty so a redemption can't exceed the
                // already-promo'd bill.
                $promotionId = null;
                $promoName = null;
                $promoDiscount = 0.0;
                if (! $trusted) {
                    $best = $this->promotions->best(
                        array_map(fn ($l) => ['product' => $l['product'], 'quantity' => $l['quantity'], 'line_total' => $l['line_total']], $lines),
                        $subtotal,
                        now()->setTimezone($shopTimezone ?: 'Asia/Karachi'),
                    );
                    if ($best !== null) {
                        $promoDiscount = round(min($best['discount'], round($subtotal - $discount, 2)), 2);
                        if ($promoDiscount > 0) {
                            $discount = round($discount + $promoDiscount, 2);
                            $promotionId = $best['promotion']->id;
                            $promoName = $best['promotion']->name;
                        }
                    }
                }

                // ── Customer-group members' discount ─────────────────────
                // An automatic percent off for a customer in a discounting group
                // (server-priced from the group's own percent — a client can't
                // dictate it), on what's still owed after cart/coupon/promo, so it
                // never pushes the bill negative. Evaluated before loyalty.
                $customerGroupId = null;
                if ($customerGroup !== null) {
                    $customerGroupId = $customerGroup->id;
                    $groupPct = $customerGroup->discount_percent !== null ? (float) $customerGroup->discount_percent : 0.0;
                    if ($groupPct > 0) {
                        $groupDiscount = round(max(0.0, round($subtotal - $discount, 2)) * min($groupPct, 100) / 100, 2);
                        if ($groupDiscount > 0) {
                            $discount = round($discount + $groupDiscount, 2);
                        }
                    }
                }

                // ── Loyalty redemption ───────────────────────────────────
                // Points the customer spends become a counter discount (points ×
                // the shop's redeem_value), folded into the bill's discount before
                // tax. A COUNT, never a price — the server prices it from its own
                // redeem_value, so a client can't dictate the value. Needs a linked
                // customer with enough points; never on the trusted path (an online
                // order / reservation carries its own settled total).
                $tenant = $this->context->get();
                $loyaltyOn = ! $trusted && (bool) ($tenant?->setting('loyalty_enabled', false));
                $pointsRedeemed = 0;
                $redeemPoints = $trusted ? 0 : (int) ($data['redeem_points'] ?? 0);
                if ($redeemPoints > 0) {
                    if (! $loyaltyOn) {
                        throw DomainException::unprocessable('Loyalty rewards are not enabled.', 'LOYALTY_DISABLED');
                    }
                    if (empty($data['customer_phone'])) {
                        throw DomainException::unprocessable(
                            "Redeeming points needs a customer — add the customer's phone.",
                            'LOYALTY_REQUIRES_CUSTOMER',
                        );
                    }
                    $existing = Customer::query()->where('phone', trim((string) $data['customer_phone']))->first();
                    if ($existing === null || $existing->loyalty_points < $redeemPoints) {
                        throw DomainException::unprocessable('The customer does not have enough points.', 'INSUFFICIENT_POINTS');
                    }
                    $minRedeem = (int) ($tenant?->setting('loyalty_min_redeem', 0));
                    if ($redeemPoints < $minRedeem) {
                        throw DomainException::unprocessable("You need at least {$minRedeem} points to redeem.", 'POINTS_BELOW_MIN');
                    }
                    $redeemValue = (float) ($tenant?->setting('loyalty_redeem_value', 1));
                    $loyaltyDiscount = round($redeemPoints * $redeemValue, 2);
                    // Points can't pay for more than the merchandise still owed
                    // (after cart + coupon discount) — keeps the bill non-negative.
                    if ($loyaltyDiscount > round($subtotal - $discount, 2) + 0.001) {
                        throw DomainException::unprocessable('Points redeemed exceed the bill.', 'POINTS_EXCEED_BILL');
                    }
                    $discount = round($discount + $loyaltyDiscount, 2);
                    $pointsRedeemed = $redeemPoints;
                }

                // Loyalty earn: points for the net merchandise on this sale (after
                // ALL discounts, incl. any redeemed value — so a customer never
                // earns points for spending points). Only when loyalty is on and a
                // customer will be linked (a phone was given).
                // Never on a practice sale: a trainee ringing their own phone
                // number all afternoon would earn a real balance to spend.
                $pointsEarned = 0;
                if ($loyaltyOn && ! $training && ! empty($data['customer_phone'])) {
                    $earnPer = (float) ($tenant?->setting('loyalty_earn_per_amount', 0));
                    $earnBase = round($subtotal - $discount, 2);
                    if ($earnPer > 0 && $earnBase > 0) {
                        $pointsEarned = (int) floor($earnBase / $earnPer);
                    }
                }

                // ── Server-authoritative tax ─────────────────────────────
                // Computed per line from each product's effective rate
                // (product.tax_rate, else the shop's default_tax_rate; 0 = exempt),
                // applied to the line's DISCOUNTED share so a cart/coupon discount
                // proportionally reduces the taxable base. A mixed basket of taxable
                // + exempt items (pharmacy) is handled correctly. A client-sent
                // `tax` is IGNORED here (it would be a fraud vector) — honored ONLY
                // on the trusted path (order/reservation completion replaying an
                // already-settled sale).
                if ($trusted && array_key_exists('tax', $data)) {
                    // Order/reservation completion replays the tax settled at
                    // placement time.
                    $tax = round((float) $data['tax'], 2);

                    // The per-line tax_rate snapshot must reflect what was ACTUALLY
                    // charged, not the product's catalog rate: an online order /
                    // reservation pickup replays a tax-free quoted total (tax => 0),
                    // so leaving the catalog 17% on the lines would make a later
                    // return refund tax the shop never collected. Blend the settled
                    // tax across the taxable base and stamp every line with it.
                    $taxableBase = round($subtotal - $discount, 2);
                    $blendedRate = $taxableBase > 0 ? round($tax / $taxableBase * 100, 4) : 0.0;
                    foreach ($lines as $i => $line) {
                        $lines[$i]['tax_rate'] = $blendedRate;
                    }
                } else {
                    // Computed from each line's snapshotted effective rate — also
                    // serves trusted callers that DIDN'T pre-settle tax (dine-in
                    // settlement prices from the tab snapshot but taxes fresh).
                    $taxableBase = $subtotal - $discount;
                    $tax = 0.0;
                    foreach ($lines as $line) {
                        $rate = (float) $line['tax_rate'];
                        if ($rate <= 0 || $subtotal <= 0) {
                            continue; // exempt / zero-rated, or nothing to tax
                        }
                        // Each line's discounted share of the taxable base.
                        $lineShare = (float) $line['line_total'] * ($taxableBase / $subtotal);
                        if ($taxInclusive) {
                            // Price already holds the tax — extract the portion
                            // within: share − share ÷ (1 + rate). The total is not
                            // inflated (see below).
                            $net = $lineShare / (1 + $rate / 100);
                            $tax = round($tax + ($lineShare - $net), 2);
                        } else {
                            // Exclusive — tax is added on top of the share.
                            $tax = round($tax + $lineShare * $rate / 100, 2);
                        }
                    }
                }

                // Inclusive: tax lives inside the price, so it is NOT added again.
                // Exclusive (and the trusted replay): tax is added on top.
                $total = $taxInclusive
                    ? round($subtotal - $discount, 2)
                    : round($subtotal - $discount + $tax, 2);
                // ── Trade-in: part of the bill settled in goods ──────────
                // The dead battery on the counter. It is a TENDER, not a
                // discount: the sale keeps its full total and the allowance
                // settles part of it, so revenue stays true and the scrap
                // becomes a countable asset instead of vanishing.
                //
                // The allowance is derived here, from the trade-in lines, and
                // never accepted as a `trade_in` payment from the client — a
                // client that could name its own would be able to settle any
                // bill with nothing crossing the counter.
                $tradeIns = $this->resolveTradeIns($tenantId, $data['trade_ins'] ?? []);
                $tradeInTotal = round(array_sum(array_column($tradeIns, 'total')), 2);

                if ($tradeInTotal > $total) {
                    // The shop would owe the customer money for their scrap.
                    // That is buying stock, not selling any — and it belongs on
                    // a purchase, where a supplier and a payment are recorded,
                    // not on a till that would have to open and hand out cash.
                    throw DomainException::unprocessable(
                        'The trade-in allowance ('.number_format($tradeInTotal, 2).') is more than the bill ('
                        .number_format($total, 2).'). Record it as a purchase instead.',
                        'TRADE_IN_EXCEEDS_TOTAL',
                    );
                }

                // Payment: one tender (payment_method + amount_paid) OR a split of
                // several tenders. When split, amount_paid is their sum and the
                // sale's method is 'split' (the breakdown lives in sale_payments).
                $payments = $data['payments'] ?? [];

                if ($tradeInTotal > 0) {
                    // Fold the single-tender form into a split so the goods slice
                    // sits alongside the rupees. From here on the arithmetic —
                    // amount_paid, PAYMENT_INSUFFICIENT, change_due — is the same
                    // one every split sale already goes through.
                    if ($payments === []) {
                        $payments = [[
                            'method' => $data['payment_method'],
                            'amount' => round((float) ($data['amount_paid'] ?? 0), 2),
                        ]];
                    }
                    $payments[] = ['method' => PaymentMethod::TradeIn->value, 'amount' => $tradeInTotal];
                }

                if (! empty($payments)) {
                    $amountPaid = round(array_sum(array_map(fn ($p) => (float) $p['amount'], $payments)), 2);
                    $methods = array_values(array_unique(array_map(fn ($p) => $p['method'], $payments)));
                    $paymentMethod = count($methods) === 1 ? $methods[0] : PaymentMethod::Split->value;
                } else {
                    $amountPaid = round((float) ($data['amount_paid'] ?? 0), 2);
                    $paymentMethod = $data['payment_method'];
                }

                // ── Schedule-controlled medicine ────────────────────────
                // A drug carrying a regulator's schedule cannot leave the shop
                // without the prescription it left on being written down — that
                // record IS the shop's licence to have sold it. Enforced only on
                // the counter path: a TRUSTED settle is goods already handed over
                // (a dine-in tab, an online order), and refusing the money at that
                // point would not un-dispense anything. The place to stop a
                // controlled drug going out online is the order, not the till.
                if (! $trusted) {
                    $controlled = array_values(array_filter(
                        $lines,
                        fn ($l) => filled($l['product']->drug_schedule ?? null),
                    ));

                    if ($controlled !== [] && (blank($data['prescription_number'] ?? null) || blank($data['prescriber_name'] ?? null))) {
                        $names = implode(', ', array_map(fn ($l) => $l['product']->name, $controlled));
                        throw DomainException::unprocessable(
                            "{$names} is schedule-controlled — record the prescription number and prescriber before dispensing.",
                            'PRESCRIPTION_REQUIRED',
                        );
                    }
                }

                // A tip rides along with the payment but is NOT revenue: the bill is
                // still the bill. It raises what the customer must hand over and
                // what the drawer should hold, and nothing else — so it is added to
                // the payment bar, never to `total`.
                $tip = max(0, round((float) ($data['tip_amount'] ?? 0), 2));
                $due = round($total + $tip, 2);

                // ── Settling in coins that exist ────────────────────────
                // A cash-only bill settles to the smallest coin the shop
                // handles. `total` is untouched — it is what tax was computed
                // on — so only what crosses the counter moves, and the gap is
                // recorded on its own. Without this the difference went into
                // the drawer variance, a few paisa per sale, until a real
                // shortage was indistinguishable from a month of change.
                $tenders = ! empty($payments)
                    ? array_map(fn ($p) => $p['method'], $payments)
                    : [$paymentMethod];
                $rounding = CashRounding::settlesInCashOnly($tenders)
                    ? CashRounding::adjustment($due, (int) ($tenant?->setting('cash_rounding', 0) ?? 0))
                    : 0.0;
                $due = round($due + $rounding, 2);

                if ($amountPaid < $due) {
                    throw DomainException::unprocessable(
                        $tip > 0
                            ? 'Amount paid ('.number_format($amountPaid, 2).') is less than the total plus tip ('.number_format($due, 2).').'
                            : 'Amount paid ('.number_format($amountPaid, 2).') is less than the total ('.number_format($due, 2).').',
                        'PAYMENT_INSUFFICIENT',
                    );
                }

                // ── Gap-free invoice number (locked counter row) ─────────
                // Practice takes its numbers from a separate sequence. The real
                // one is gap-free on purpose — a tax authority reads a hole in
                // it as a deleted sale — and an afternoon of training would
                // punch holes in it every day.
                $invoiceNumber = $this->nextInvoiceNumber($tenantId, $training);

                // The lane this sale was rung on: the shift knows it (a shift is
                // cashier × terminal). A shop that doesn't enforce shifts still has
                // a terminal — fall back to the resolved one, so the receipt and
                // the per-lane report can still name the counter. Both sources are
                // server-side; neither is the client's word.
                $registerId = (! empty($data['cash_session_id'])
                    ? CashSession::query()->whereKey($data['cash_session_id'])->value('register_id')
                    : null) ?? app(RegisterContext::class)->id();

                /** @var Sale $sale */
                $sale = Sale::query()->create([
                    'invoice_number' => $invoiceNumber,
                    'branch_id' => $branchId,
                    'channel' => $data['channel'],
                    'cash_session_id' => $data['cash_session_id'] ?? null,
                    // Which lane rang it. Derived from the shift, never accepted
                    // from the client — a per-lane X report has to reflect where
                    // the cash physically went, not what a browser claimed.
                    'register_id' => $registerId,
                    'status' => SaleStatus::Completed,
                    // Copied from the shift, never accepted from the client.
                    // A global scope on this model fences these out of every
                    // query that does not explicitly ask for them.
                    'is_training' => $training,
                    'customer_name' => $data['customer_name'] ?? null,
                    'customer_phone' => $data['customer_phone'] ?? null,
                    // The vehicle the work was done on, and the reading taken
                    // while it was on the ramp. Null for every trade that does
                    // not touch vehicles, which is most of them.
                    'vehicle_id' => $data['vehicle_id'] ?? null,
                    'odometer' => $data['odometer'] ?? null,
                    'customer_group_id' => $customerGroupId,
                    'order_type' => $data['order_type'] ?? null,
                    'table_no' => $data['table_no'] ?? null,
                    'subtotal' => $subtotal,
                    'discount' => $discount,
                    'coupon_code' => $couponCode,
                    'promotion_id' => $promotionId,
                    'promo_name' => $promoName,
                    'promo_discount' => $promoDiscount,
                    'tax' => $tax,
                    'tax_inclusive' => $taxInclusive,
                    'total' => $total,
                    'payment_method' => $paymentMethod,
                    'amount_paid' => $amountPaid,
                    // How much of the bill was settled in goods rather than
                    // rupees — so a receipt, a report or a margin calculation
                    // can separate the two without joining tender rows.
                    'trade_in_total' => $tradeInTotal,
                    'tip_amount' => $tip,
                    // What settling in cash cost (or saved) the shop. Negative
                    // when it gave up the difference. Never folded into `total`
                    // — that is the taxed figure.
                    'rounding_adjustment' => $rounding,
                    // Change is what's left after the bill, the tip AND the
                    // rounding — otherwise the cashier hands back the tip, or
                    // the paisa the shop just agreed to forgo.
                    'change_due' => round($amountPaid - $due, 2),
                    'points_earned' => $pointsEarned,
                    'points_redeemed' => $pointsRedeemed,
                    'notes' => $data['notes'] ?? null,
                    // Pharmacy: prescription record (captured at POS for Rx items).
                    'prescription_number' => $data['prescription_number'] ?? null,
                    'prescriber_name' => $data['prescriber_name'] ?? null,
                    'patient_name' => $data['patient_name'] ?? null,
                    'prescription_notes' => $data['prescription_notes'] ?? null,
                    'idempotency_key' => $data['idempotency_key'] ?? null,
                    'sold_at' => now(),
                ]);

                // The vehicle's own record moves forward with the job: the last
                // odometer reading is what a service interval is counted from,
                // and a shop that never wrote it down can only guess. Only ever
                // forward — a lower reading is a typo or a replaced cluster, and
                // accepting it would silently reset every reminder.
                if (! empty($data['vehicle_id'])) {
                    CustomerVehicle::query()
                        ->whereKey($data['vehicle_id'])
                        ->first()
                        ?->recordOdometer($data['odometer'] ?? null);
                }

                // CRM: capture / link the buyer when a phone was given.
                $customer = null;
                if (! empty($data['customer_phone'])) {
                    $customer = Customer::capture($tenantId, $data['customer_phone'], $data['customer_name'] ?? null);
                    if ($customer !== null) {
                        $sale->forceFill(['customer_id' => $customer->id])->save();
                    }
                }

                // Apply loyalty under a row lock (concurrent tills can't lose an
                // update or double-spend): redeem first, then earn. The balance is
                // re-checked here authoritatively — a stale earlier read that lost a
                // race rolls the whole sale back. Ledger entries carry the sale id
                // so a return/cancel reverses exactly this.
                if ($customer !== null && ($pointsRedeemed > 0 || $pointsEarned > 0)) {
                    $locked = Customer::query()->whereKey($customer->id)->lockForUpdate()->first();
                    if ($pointsRedeemed > 0) {
                        if ($locked->loyalty_points < $pointsRedeemed) {
                            throw DomainException::unprocessable('The customer does not have enough points.', 'INSUFFICIENT_POINTS');
                        }
                        $locked->redeemPoints($pointsRedeemed, $sale->id, "Sale {$invoiceNumber}");
                    }
                    if ($pointsEarned > 0) {
                        $locked->earnPoints($pointsEarned, $sale->id, "Sale {$invoiceNumber}");
                    }
                }

                // ── Lines + stock decrement through the audited path ─────
                // Serials entered anywhere in this sale — guards against the same
                // IMEI being keyed onto two lines of one sale.
                $seenSerials = [];
                foreach ($lines as $line) {
                    // Snapshot the exploded BOM (per-unit component quantities) for
                    // combo/recipe lines, so a later return restocks exactly what
                    // was sold even if the recipe/combo is edited in between.
                    $componentsSnapshot = $this->bomSnapshot($line['product']);

                    $saleItem = $sale->items()->create([
                        'tenant_id' => $tenantId,
                        'product_id' => $line['product']->id,
                        'variant_id' => $line['variant']?->id,
                        'product_name' => $line['product']->name,
                        'variant_name' => $line['variant']?->name,
                        'unit_name' => $line['unit']?->name,
                        'directions' => $line['directions'] ?? null,
                        'modifiers' => $line['modifiers'] ?: null,
                        'components' => $componentsSnapshot,
                        'sku' => $line['variant']?->sku ?? $line['product']->sku,
                        'item_type' => $line['product']->type->value,
                        'quantity' => $line['quantity'],
                        'unit_factor' => $line['factor'],
                        'unit_price' => $line['unit_price'],
                        'unit_cost' => $line['unit_cost'],
                        'line_discount' => $line['line_discount'],
                        'line_total' => $line['line_total'],
                        'tax_rate' => $line['tax_rate'],
                    ]);

                    // Serialized retail: snapshot each unit's serial + warranty.
                    $this->recordSerials($saleItem, $line, $sale, $seenSerials);

                    if ($skipStock) {
                        // Layaway collection: the units were drawn down when the
                        // advance was taken. Nothing to move — and no counter-
                        // movement either, because the stock never came back.
                    } elseif ($line['product']->isCombo()) {
                        // A deal holds no stock of its own — selling it draws each
                        // component's stock down by (component qty × deal qty). An
                        // out-of-stock component fails the whole sale (can't sell a
                        // deal you can't assemble).
                        foreach ($line['product']->comboItems()->with('component')->get() as $ci) {
                            $component = $ci->component;
                            if ($component !== null && $component->type === ItemType::Product && $component->track_inventory) {
                                $this->inventory->adjust([
                                    'product_id' => $component->id,
                                    'type' => 'out',
                                    'quantity' => round((float) $ci->quantity * $line['quantity'], 3),
                                    'reason' => "Sale {$invoiceNumber} (deal: {$line['product']->name})",
                                    'reference_type' => 'sale',
                                    'reference_id' => $sale->id,
                                    // Fresh POS sale: a short component must fail the
                                    // sale (you can't assemble a deal you don't have).
                                    // TRUSTED settle (dine-in tab / online order) is
                                    // different — the deal was already handed over, so
                                    // it must never block collecting the money; it just
                                    // shows negative for recount, like the recipe path.
                                    'allow_negative' => $trusted,
                                    'branch_id' => $branchId,
                                ]);
                            }
                        }
                    } elseif ($line['product']->hasRecipe()) {
                        // A made-to-order dish holds no stock of its own — selling it
                        // draws each raw ingredient down by (ingredient qty × dish
                        // qty). allow_negative: the dish is already made, so a short
                        // or under-recorded ingredient must never fail the sale (it
                        // just shows as negative stock to recount) — and a dine-in
                        // settle of food already served can never be blocked.
                        foreach ($line['product']->recipeItems()->with('ingredient')->get() as $ri) {
                            $ingredient = $ri->ingredient;
                            if ($ingredient !== null && $ingredient->type === ItemType::Product && $ingredient->track_inventory) {
                                $this->inventory->adjust([
                                    'product_id' => $ingredient->id,
                                    'type' => 'out',
                                    'quantity' => round((float) $ri->quantity * $line['quantity'], 3),
                                    'reason' => "Sale {$invoiceNumber} (recipe: {$line['product']->name})",
                                    'reference_type' => 'sale',
                                    'reference_id' => $sale->id,
                                    'allow_negative' => true,
                                    'branch_id' => $branchId,
                                ]);
                            }
                        }
                    } elseif ($line['product']->type === ItemType::Product && $line['product']->track_inventory) {
                        $this->inventory->adjust([
                            'product_id' => $line['product']->id,
                            'variant_id' => $line['variant']?->id,
                            'type' => 'out',
                            // Stock is counted in BASE units — a pack draws factor× its count.
                            'quantity' => round($line['quantity'] * $line['factor'], 3),
                            'reason' => "Sale {$invoiceNumber}",
                            'reference_type' => 'sale',
                            'reference_id' => $sale->id,
                            'branch_id' => $branchId,
                        ]);
                    }
                }

                // ── The goods that came the other way ────────────────────
                // The scrap enters stock at the moment it crosses the counter.
                // A dead battery is worth real money to a scrap dealer; before
                // this it was bought, stored and sold with no record at either
                // end, which is exactly the gap a batch of them walks out of.
                foreach ($tradeIns as $t) {
                    $sale->tradeIns()->create([
                        'tenant_id' => $tenantId,
                        'branch_id' => $branchId,
                        'product_id' => $t['product']->id,
                        // Snapshot, like a sale line: deleting the scrap SKU
                        // later must never corrupt what this sale recorded.
                        'product_name' => $t['product']->name,
                        'description' => $t['description'],
                        'quantity' => $t['quantity'],
                        'unit_allowance' => $t['unit_allowance'],
                        'total_allowance' => $t['total'],
                        'notes' => $t['notes'],
                    ]);

                    if ($t['product']->track_inventory) {
                        $this->inventory->adjust([
                            'product_id' => $t['product']->id,
                            'type' => 'in',
                            'quantity' => $t['quantity'],
                            'reason' => "Trade-in on {$invoiceNumber}",
                            'reference_type' => 'sale_trade_in',
                            'reference_id' => $sale->id,
                            'branch_id' => $branchId,
                        ]);
                    }
                }

                // Record the tender breakdown — a single-tender sale gets one row,
                // a split gets one per method. Cash-drawer reconciliation reads the
                // CASH rows here (see CloseCashSessionAction), so a split sale's
                // cash portion is still counted at shift close.
                $tenders = ! empty($payments)
                    ? $payments
                    : [['method' => $paymentMethod, 'amount' => $amountPaid]];
                foreach ($tenders as $t) {
                    $sale->payments()->create([
                        'tenant_id' => $tenantId,
                        'method' => $t['method'],
                        'amount' => round((float) $t['amount'], 2),
                        'reference' => $t['reference'] ?? null,
                    ]);
                }

                // Sell-on-credit: a 'credit' tender goes onto the customer's khata
                // instead of being received now. It needs a linked customer, and is
                // capped by the customer's credit limit (both enforced here).
                $creditTotal = round(array_sum(array_map(
                    fn ($t) => ($t['method'] ?? null) === PaymentMethod::Credit->value ? (float) $t['amount'] : 0.0,
                    $tenders,
                )), 2);
                if ($creditTotal > 0) {
                    if ($customer === null) {
                        throw DomainException::unprocessable(
                            "A credit (khata) sale needs a customer — add the customer's phone.",
                            'CREDIT_REQUIRES_CUSTOMER',
                        );
                    }
                    // A khata sale must never produce cash change: the non-credit
                    // tenders should cover the rest of the bill exactly. If money
                    // paid exceeds the total while part is on credit, the cashier
                    // would be told to hand out real cash against a promise-to-pay
                    // (a fat-fingered credit amount turns the POS into a cash
                    // dispenser and inflates the receivable). Reject it.
                    if (round($amountPaid - $total, 2) > 0) {
                        throw DomainException::unprocessable(
                            'A credit (khata) sale cannot give cash change — the amount on credit is more than what is owed.',
                            'CREDIT_EXCEEDS_DUE',
                        );
                    }
                    // Lock the customer row before the read-modify-write on their
                    // balance, mirroring the return/cancel reversal paths — two POS
                    // terminals ringing khata sales for the same customer must not
                    // lose an update or race past the credit limit.
                    $locked = Customer::query()->whereKey($customer->id)->lockForUpdate()->first();
                    $locked->chargeCredit($creditTotal, $sale->id, "Sale {$invoiceNumber}");
                }

                return $sale->load('items', 'payments', 'tradeIns', 'vehicle');
            });
        } catch (QueryException $e) {
            // A concurrent same-key request won the race: its unique-constraint
            // violation means the sale already exists — return it, not a 500.
            if (! empty($data['idempotency_key']) && (string) $e->getCode() === '23000') {
                $existing = Sale::query()->where('idempotency_key', $data['idempotency_key'])->first();
                if ($existing !== null) {
                    return $existing->load('items');
                }
            }
            throw $e;
        }
    }

    /**
     * The branch's overridden retail price for a product/variant, or null when
     * the branch uses the catalog price. Variant lines match their own row
     * (variant_id set); product lines match the product-level row (null variant).
     */
    private function branchPrice(?string $branchId, string $productId, ?string $variantId): ?float
    {
        if ($branchId === null) {
            return null;
        }

        $query = BranchPrice::query()
            ->where('branch_id', $branchId)
            ->where('product_id', $productId);

        $variantId === null
            ? $query->whereNull('variant_id')
            : $query->where('variant_id', $variantId);

        $price = $query->value('price');

        return $price !== null ? (float) $price : null;
    }

    /**
     * Persist the serialized units on a line: guard each serial against a
     * duplicate within THIS sale and against any serial still out on a live
     * (completed / partially-refunded) sale, then snapshot it with its warranty
     * window. A cancelled/fully-refunded sale frees its serials automatically —
     * the guard only looks at live sales — so a returned unit can be resold.
     *
     * @param  array<string, true>  $seen  serials already keyed earlier in this sale
     */
    private function recordSerials(SaleItem $saleItem, array $line, Sale $sale, array &$seen): void
    {
        $serials = $line['serials'] ?? [];
        if (empty($serials)) {
            return;
        }

        /** @var Product $product */
        $product = $line['product'];
        $months = $line['warranty_months']
            ?? ($product->warranty_months !== null ? (int) $product->warranty_months : null);
        $expires = $months !== null && $months > 0
            ? $sale->sold_at->copy()->addMonths($months)
            : null;

        foreach ($serials as $serial) {
            if (isset($seen[$serial])) {
                throw DomainException::unprocessable(
                    "Serial \"{$serial}\" is entered twice in this sale.",
                    'SERIAL_DUPLICATE_IN_SALE',
                );
            }

            // Out on another LIVE (completed / partially-refunded) sale and NOT
            // since returned. A cancelled/fully-refunded/returned serial is free.
            $alreadyOut = SaleItemSerial::query()
                ->where('serial', $serial)
                ->whereNull('returned_at')
                ->whereHas('sale', fn ($q) => $q->whereIn('status', [
                    SaleStatus::Completed->value,
                    SaleStatus::PartiallyRefunded->value,
                ]))
                ->exists();
            if ($alreadyOut) {
                throw DomainException::unprocessable(
                    "Serial \"{$serial}\" has already been sold.",
                    'SERIAL_ALREADY_SOLD',
                );
            }

            // Stock registry: a serial that was formally RECEIVED can only be
            // sold from stock. If it's already marked sold there, block it (a
            // stronger cross-sale guard); if it's in stock, draw it down and
            // link the sale. A serial never received (legacy / walk-in) simply
            // has no registry row — the sale still records it below.
            $registry = ProductSerial::query()
                ->where('product_id', $product->id)
                ->where('serial', $serial)
                ->lockForUpdate()
                ->first();
            if ($registry !== null && $registry->status === 'sold') {
                throw DomainException::unprocessable(
                    "Serial \"{$serial}\" has already been sold.",
                    'SERIAL_ALREADY_SOLD',
                );
            }

            $saleItem->serials()->create([
                'tenant_id' => $sale->tenant_id,
                'sale_id' => $sale->id,
                'product_id' => $product->id,
                'variant_id' => $line['variant']?->id,
                'product_serial_id' => $registry?->id,
                'product_name' => $product->name,
                'serial' => $serial,
                'warranty_months' => $months,
                'warranty_expires_at' => $expires,
                'sold_at' => $sale->sold_at,
            ]);

            if ($registry !== null) {
                $registry->forceFill(['status' => 'sold', 'sale_id' => $sale->id])->save();
            }

            $seen[$serial] = true;
        }
    }

    /**
     * The exploded, per-unit BOM for a combo/recipe product — the tracked
     * physical components/ingredients a single unit depletes, snapshotted onto
     * the sale line so a return restocks these exact items/quantities even if
     * the composition is edited later. Null for plain products (they restock
     * themselves).
     *
     * @return array<int, array{product_id: string, variant_id: null, name: string, quantity_per_unit: float}>|null
     */
    private function bomSnapshot(Product $product): ?array
    {
        if ($product->isCombo()) {
            $rows = $product->comboItems()->with('component')->get()
                ->map(fn ($ci) => [$ci->component, (float) $ci->quantity]);
        } elseif ($product->hasRecipe()) {
            $rows = $product->recipeItems()->with('ingredient')->get()
                ->map(fn ($ri) => [$ri->ingredient, (float) $ri->quantity]);
        } else {
            return null;
        }

        $snapshot = [];
        foreach ($rows as [$component, $qtyPerUnit]) {
            if ($component !== null && $component->type === ItemType::Product && $component->track_inventory) {
                $snapshot[] = [
                    'product_id' => $component->id,
                    'variant_id' => null,
                    'name' => $component->name,
                    'quantity_per_unit' => $qtyPerUnit,
                ];
            }
        }

        return $snapshot ?: null;
    }

    /**
     * Resolve the goods a customer handed over in part-payment.
     *
     * Each line names a scrap SKU the shop already keeps — "Scrap Battery",
     * "Used Tyre" — so the allowance lands somewhere countable. A free-text
     * trade-in would put value into the shop that no stock report could ever
     * see, which is the failure this whole thing exists to close.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<int, array{product: Product, quantity: float, unit_allowance: float, total: float, description: ?string, notes: ?string}>
     */
    private function resolveTradeIns(string $tenantId, array $rows): array
    {
        if ($rows === []) {
            return [];
        }

        $products = Product::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereIn('id', array_column($rows, 'product_id'))
            ->get()
            ->keyBy('id');

        $out = [];

        foreach ($rows as $row) {
            $product = $products->get($row['product_id'] ?? '');

            if ($product === null) {
                throw DomainException::unprocessable(
                    'That trade-in item is no longer available.',
                    'PRODUCT_UNAVAILABLE',
                );
            }

            // A service cannot be handed across a counter. Accepting one would
            // create an allowance backed by nothing.
            if ($product->type !== ItemType::Product) {
                throw DomainException::unprocessable(
                    "{$product->name} isn't a stock item — a trade-in has to be something the shop can put on a shelf.",
                    'TRADE_IN_NOT_STOCKABLE',
                );
            }

            $quantity = round((float) ($row['quantity'] ?? 1), 3);
            $unitAllowance = round((float) ($row['unit_allowance'] ?? 0), 2);

            if ($quantity <= 0) {
                throw DomainException::unprocessable(
                    'A trade-in needs a quantity.',
                    'TRADE_IN_INVALID',
                );
            }

            $out[] = [
                'product' => $product,
                'quantity' => $quantity,
                'unit_allowance' => $unitAllowance,
                'total' => round($quantity * $unitAllowance, 2),
                'description' => $row['description'] ?? null,
                'notes' => $row['notes'] ?? null,
            ];
        }

        return $out;
    }

    /**
     * What a practice sale may not do.
     *
     * Training rings ordinary sales: items, discounts, tenders, change, a
     * printed receipt. That is the cashier's job and the thing worth practising.
     *
     * Everything refused here reaches OUTSIDE the sale and touches a real
     * record — a customer's debt, their points balance, a serial's history, the
     * scrap that entered stock. Each could be skipped instead, and each skip
     * would be a quiet lie: a khata sale that never charged anyone, a serial
     * sold twice. Refusing says so out loud, which is what a trainee needs to
     * hear anyway.
     *
     * @param  array<string, mixed>  $data
     */
    private function assertTrainable(array $data): void
    {
        if ((int) ($data['redeem_points'] ?? 0) > 0) {
            throw DomainException::unprocessable(
                'Loyalty points cannot be redeemed on a training shift — that would spend a real customer’s points.',
                'TRAINING_NOT_AVAILABLE',
            );
        }

        $onCredit = collect($data['payments'] ?? [])
            ->contains(fn ($p) => ($p['method'] ?? null) === 'credit');

        if ($onCredit || ($data['payment_method'] ?? null) === 'credit') {
            throw DomainException::unprocessable(
                'Credit (khata) is not available on a training shift — it would put a real debt on a real customer.',
                'TRAINING_NOT_AVAILABLE',
            );
        }

        if (! empty($data['trade_ins'])) {
            throw DomainException::unprocessable(
                'Trade-ins are not available on a training shift — the goods taken in would enter real stock.',
                'TRAINING_NOT_AVAILABLE',
            );
        }

        foreach ($data['items'] ?? [] as $item) {
            if (! empty($item['serials'])) {
                throw DomainException::unprocessable(
                    'Serialized items cannot be sold on a training shift — the serial would be marked sold for good.',
                    'TRAINING_NOT_AVAILABLE',
                );
            }
        }
    }

    private function nextInvoiceNumber(string $tenantId, bool $training = false): string
    {
        // Ensure the counter row exists, then lock + increment it. Rollback
        // of the surrounding transaction rolls the increment back too —
        // invoice numbers stay sequential and gap-free.
        DB::table('invoice_counters')->insertOrIgnore([
            'tenant_id' => $tenantId,
            'next_number' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $column = $training ? 'training_next_number' : 'next_number';

        $counter = DB::table('invoice_counters')
            ->where('tenant_id', $tenantId)
            ->lockForUpdate()
            ->first();

        DB::table('invoice_counters')
            ->where('tenant_id', $tenantId)
            ->update([$column => $counter->{$column} + 1, 'updated_at' => now()]);

        // A different prefix, so a practice receipt can never be mistaken for a
        // real one on paper — the number itself says which it is.
        return ($training ? 'TRN-' : 'INV-')
            .str_pad((string) $counter->{$column}, 6, '0', STR_PAD_LEFT);
    }

    /**
     * Refuse a discount past the shop's ceiling unless the person ringing it
     * holds discounts.override.
     *
     * Both limits are opt-in (null = no ceiling): the control never existed
     * before, so defaulting to a cap would have stopped shops from selling the
     * day it shipped. An owner sets them in Settings → POS.
     */
    private function assertWithinDiscountCeiling(float $discount, float $subtotal): void
    {
        if ($discount <= 0) {
            return;
        }

        $settings = $this->context->get();
        $maxPct = $settings?->setting('max_discount_percent');
        $maxAmt = $settings?->setting('max_discount_amount');

        if (($maxPct === null || $maxPct === '') && ($maxAmt === null || $maxAmt === '')) {
            return; // no ceiling configured
        }

        $user = auth()->user();
        // No authenticated actor = a backend/headless caller, which is trusted
        // by definition (the HTTP paths always have one).
        if ($user === null || $user->hasPermission(Permissions::DISCOUNTS_OVERRIDE)) {
            return;
        }

        $pct = $subtotal > 0 ? round(($discount / $subtotal) * 100, 2) : 0.0;
        $sym = $settings?->currencySymbol() ?? 'Rs';

        if ($maxPct !== null && $maxPct !== '' && $pct > (float) $maxPct + 0.001) {
            throw DomainException::forbidden(
                "This discount is {$pct}% — above the {$maxPct}% limit. A manager has to approve it.",
                'DISCOUNT_LIMIT_EXCEEDED',
            );
        }

        if ($maxAmt !== null && $maxAmt !== '' && $discount > (float) $maxAmt + 0.001) {
            throw DomainException::forbidden(
                "This discount is {$sym} ".number_format($discount, 2)
                    ." — above the {$sym} ".number_format((float) $maxAmt, 2)
                    .' limit. A manager has to approve it.',
                'DISCOUNT_LIMIT_EXCEEDED',
            );
        }
    }
}
