<?php

namespace App\Actions\Sale;

use App\Enums\ItemType;
use App\Enums\PaymentMethod;
use App\Enums\SaleStatus;
use App\Exceptions\DomainException;
use App\Models\BranchPrice;
use App\Models\Customer;
use App\Models\Product;
use App\Models\ProductUnit;
use App\Models\ProductVariant;
use App\Models\Sale;
use App\Services\CouponService;
use App\Services\InventoryService;
use App\Support\BranchContext;
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

            // ── Build lines with fresh, locked product data ──────────
            $lines = [];
            $subtotal = 0.0;

            // The shop's default tax rate — each line snapshots its effective
            // rate (product rate else this default) so returns can refund tax.
            $defaultTaxRate = (float) ($this->context->get()?->setting('default_tax_rate', 0) ?? 0);

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
                // when the item has no wholesale rate.
                $level = ($item['price_level'] ?? 'retail') === 'wholesale' ? 'wholesale' : 'retail';
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
                    [$modifierDelta, $modifierSnapshot] = \App\Support\ModifierResolver::resolve(
                        $product,
                        $item['modifier_option_ids'] ?? [],
                    );
                }

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
                    // Effective tax %% snapshot — product rate else shop default.
                    'tax_rate' => $product->tax_rate !== null ? (float) $product->tax_rate : $defaultTaxRate,
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
                'branch_id' => $branchId,
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
