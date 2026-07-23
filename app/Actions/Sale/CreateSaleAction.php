<?php

namespace App\Actions\Sale;

use App\Enums\ItemType;
use App\Enums\PaymentMethod;
use App\Enums\SaleStatus;
use App\Exceptions\DomainException;
use App\Models\Customer;
use App\Models\Product;
use App\Models\ProductUnit;
use App\Models\ProductVariant;
use App\Models\Sale;
use App\Services\CouponService;
use App\Services\InventoryService;
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
    ) {
    }

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

            // Pricing is SERVER-authoritative. A line unit_price + skipping the
            // serving-window check are honored ONLY on the trusted internal
            // path (order/reservation completion replaying an already-placed
            // line) — never from HTTP input, where a unit_price would be a
            // price-override fraud vector. StoreSaleRequest strips unit_price;
            // trusted_prices can only be set by backend callers.
            $trusted = (bool) ($data['trusted_prices'] ?? false);
            $shopTimezone = $this->context->get()?->timezone;

            // ── Build lines with fresh, locked product data ──────────
            $lines = [];
            $subtotal = 0.0;

            foreach ($data['items'] as $item) {
                /** @var Product|null $product */
                $product = Product::query()
                    ->whereKey($item['product_id'])
                    ->where('is_active', true)
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

                    if ($variant === null || ! $variant->is_active) {
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

                // Price level (retail | wholesale) — a named price list. It
                // sets the per-unit RETAIL-or-WHOLESALE rate; packs multiply it,
                // variants keep their own price. Wholesale falls back to retail
                // when the item has no wholesale rate.
                $level = ($item['price_level'] ?? 'retail') === 'wholesale' ? 'wholesale' : 'retail';
                $levelUnit = $product->priceForLevel($level, $quantity);

                $basePrice = $trusted && isset($item['unit_price'])
                    ? (float) $item['unit_price']
                    : ($unit !== null
                        ? $unit->priceUsing($levelUnit)
                        : ($variant !== null ? (float) $variant->price : $levelUnit));

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
                    [$modifierDelta, $modifierSnapshot] = \App\Support\ModifierResolver::resolve(
                        $product,
                        $item['modifier_option_ids'] ?? [],
                    );
                }

                $unitPrice = round($basePrice + $modifierDelta, 2);
                $gross = round($unitPrice * $quantity, 2);

                // Per-line discount (POS): computed off the SERVER's own line
                // price. A percentage wins if given; a fixed amount is clamped
                // so it can never exceed the line (no negative lines). Ignored
                // on the trusted path (order/reservation completion).
                $lineDiscount = 0.0;
                if (! $trusted) {
                    if (($pct = (float) ($item['line_discount_pct'] ?? 0)) > 0) {
                        $lineDiscount = round($gross * min($pct, 100) / 100, 2);
                    } elseif (($amt = (float) ($item['line_discount'] ?? 0)) > 0) {
                        $lineDiscount = min(round($amt, 2), $gross);
                    }
                }

                $lineTotal = round($gross - $lineDiscount, 2);
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

            // Coupon: validate + consume, add its discount (clamped to subtotal).
            $couponCode = null;
            if (! empty($data['coupon_code'])) {
                $result = $this->coupons->apply($tenantId, $data['coupon_code'], $subtotal);
                $discount = round(min($discount + $result['discount'], $subtotal), 2);
                $couponCode = $result['code'];
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
            if ($trusted) {
                $tax = round((float) ($data['tax'] ?? 0), 2);
            } else {
                $defaultRate = (float) ($this->context->get()?->setting('default_tax_rate', 0) ?? 0);
                $taxableBase = $subtotal - $discount;
                $tax = 0.0;
                foreach ($lines as $line) {
                    $rate = $line['product']->tax_rate !== null
                        ? (float) $line['product']->tax_rate
                        : $defaultRate;
                    if ($rate <= 0 || $subtotal <= 0) {
                        continue; // exempt / zero-rated, or nothing to tax
                    }
                    $lineBase = (float) $line['line_total'] * ($taxableBase / $subtotal);
                    $tax = round($tax + $lineBase * $rate / 100, 2);
                }
            }

            $total = round($subtotal - $discount + $tax, 2);
            // Payment: one tender (payment_method + amount_paid) OR a split of
            // several tenders. When split, amount_paid is their sum and the
            // sale's method is 'split' (the breakdown lives in sale_payments).
            $payments = $data['payments'] ?? [];
            if (! empty($payments)) {
                $amountPaid = round(array_sum(array_map(fn ($p) => (float) $p['amount'], $payments)), 2);
                $methods = array_values(array_unique(array_map(fn ($p) => $p['method'], $payments)));
                $paymentMethod = count($methods) === 1 ? $methods[0] : PaymentMethod::Split->value;
            } else {
                $amountPaid = round((float) ($data['amount_paid'] ?? 0), 2);
                $paymentMethod = $data['payment_method'];
            }

            if ($amountPaid < $total) {
                throw DomainException::unprocessable(
                    "Amount paid (".number_format($amountPaid, 2).") is less than the total (".number_format($total, 2).").",
                    'PAYMENT_INSUFFICIENT',
                );
            }

            // ── Gap-free invoice number (locked counter row) ─────────
            $invoiceNumber = $this->nextInvoiceNumber($tenantId);

            /** @var Sale $sale */
            $sale = Sale::query()->create([
                'invoice_number' => $invoiceNumber,
                'channel' => $data['channel'],
                'cash_session_id' => $data['cash_session_id'] ?? null,
                'status' => SaleStatus::Completed,
                'customer_name' => $data['customer_name'] ?? null,
                'customer_phone' => $data['customer_phone'] ?? null,
                'order_type' => $data['order_type'] ?? null,
                'table_no' => $data['table_no'] ?? null,
                'subtotal' => $subtotal,
                'discount' => $discount,
                'coupon_code' => $couponCode,
                'tax' => $tax,
                'total' => $total,
                'payment_method' => $paymentMethod,
                'amount_paid' => $amountPaid,
                'change_due' => round($amountPaid - $total, 2),
                'notes' => $data['notes'] ?? null,
                // Pharmacy: prescription record (captured at POS for Rx items).
                'prescription_number' => $data['prescription_number'] ?? null,
                'prescriber_name' => $data['prescriber_name'] ?? null,
                'patient_name' => $data['patient_name'] ?? null,
                'prescription_notes' => $data['prescription_notes'] ?? null,
                'idempotency_key' => $data['idempotency_key'] ?? null,
                'sold_at' => now(),
            ]);

            // CRM: capture / link the buyer when a phone was given.
            $customer = null;
            if (! empty($data['customer_phone'])) {
                $customer = Customer::capture($tenantId, $data['customer_phone'], $data['customer_name'] ?? null);
                if ($customer !== null) {
                    $sale->forceFill(['customer_id' => $customer->id])->save();
                }
            }

            // ── Lines + stock decrement through the audited path ─────
            foreach ($lines as $line) {
                $sale->items()->create([
                    'tenant_id' => $tenantId,
                    'product_id' => $line['product']->id,
                    'variant_id' => $line['variant']?->id,
                    'product_name' => $line['product']->name,
                    'variant_name' => $line['variant']?->name,
                    'unit_name' => $line['unit']?->name,
                    'modifiers' => $line['modifiers'] ?: null,
                    'sku' => $line['variant']?->sku ?? $line['product']->sku,
                    'item_type' => $line['product']->type->value,
                    'quantity' => $line['quantity'],
                    'unit_factor' => $line['factor'],
                    'unit_price' => $line['unit_price'],
                    'unit_cost' => $line['unit_cost'],
                    'line_discount' => $line['line_discount'],
                    'line_total' => $line['line_total'],
                ]);

                if ($line['product']->isCombo()) {
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
                $customer->chargeCredit($creditTotal, $sale->id, "Sale {$invoiceNumber}");
            }

            return $sale->load('items', 'payments');
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

    private function nextInvoiceNumber(string $tenantId): string
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

        $counter = DB::table('invoice_counters')
            ->where('tenant_id', $tenantId)
            ->lockForUpdate()
            ->first();

        DB::table('invoice_counters')
            ->where('tenant_id', $tenantId)
            ->update(['next_number' => $counter->next_number + 1, 'updated_at' => now()]);

        return 'INV-'.str_pad((string) $counter->next_number, 6, '0', STR_PAD_LEFT);
    }
}
