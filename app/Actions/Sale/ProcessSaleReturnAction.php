<?php

namespace App\Actions\Sale;

use App\Enums\ItemType;
use App\Enums\SaleStatus;
use App\Exceptions\DomainException;
use App\Models\Customer;
use App\Models\Product;
use App\Models\ProductSerial;
use App\Models\ProductVariant;
use App\Models\Sale;
use App\Models\SaleItemSerial;
use App\Models\SaleReturn;
use App\Models\SaleReturnItem;
use App\Services\InventoryService;
use App\Support\BooksDrawer;
use App\Support\DocumentCounter;
use App\Support\RecipeFor;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

/**
 * Processes a full or partial return against a completed sale:
 *   validate quantities → restock (IN via InventoryService) → refund record
 *   → recompute sale status (partially_refunded / refunded).
 *
 * A line can never be returned for more than was sold (minus prior returns).
 */
class ProcessSaleReturnAction
{
    public function __construct(
        private readonly InventoryService $inventory,
        private readonly TenantContext $context,
    ) {}

    /**
     * @param array{
     *   items: array<array{sale_item_id: string, quantity: float}>,
     *   reason?: ?string, refund_method?: string, notes?: ?string,
     *   cash_session_id?: ?string, skip_credit_reversal?: bool
     * } $data
     */
    public function execute(Sale $sale, array $data): SaleReturn
    {
        // Replay path — the retry gets the ORIGINAL return back. Without this a
        // double-clicked PARTIAL return refunds cash twice and restocks twice:
        // the over-return guard reads PRIOR returns (3 of 10 passes again), and
        // the restock idempotency keys embed the new return's id so they don't
        // collapse either. Checked before the transaction, like the sale path.
        if (! empty($data['idempotency_key'])) {
            $existing = SaleReturn::query()
                ->where('idempotency_key', $data['idempotency_key'])
                ->first();

            if ($existing !== null) {
                return $existing->load('items');
            }
        }

        if (! $sale->status->isReturnable()) {
            throw DomainException::conflict('This sale cannot be returned.', 'SALE_NOT_RETURNABLE');
        }

        try {
            return DB::transaction(function () use ($sale, $data): SaleReturn {
                $tenantId = $this->context->id();
                $sale->load('items');

                // Refunds are coupon/discount-aware: a sale-level discount was
                // spread across the whole basket, so each returned unit refunds
                // its DISCOUNTED share, never the full sticker price — otherwise
                // refunds could exceed what the customer actually paid.
                $saleSubtotal = (float) $sale->subtotal;
                $saleDiscount = (float) $sale->discount;
                $discountRatio = $saleSubtotal > 0 ? $saleDiscount / $saleSubtotal : 0.0;

                // Tax refunds line-exactly from each line's snapshotted rate; a
                // legacy line without a snapshot falls back to the sale's overall
                // effective rate — either way the customer gets back the tax they
                // paid on what they're returning, never just the pre-tax price.
                $taxableBase = round($saleSubtotal - $saleDiscount, 2);
                // Inclusive: line_total already CONTAINS the tax, so the fallback
                // rate is derived from the tax as a fraction of the net (base − tax),
                // and the refund total is the line share alone (see below).
                $inclusive = (bool) $sale->tax_inclusive;
                $fallbackRate = (float) $sale->tax > 0
                    ? ($inclusive
                        ? ($taxableBase - (float) $sale->tax > 0
                            ? (float) $sale->tax / ($taxableBase - (float) $sale->tax) * 100
                            : 0.0)
                        : ($taxableBase > 0 ? (float) $sale->tax / $taxableBase * 100 : 0.0))
                    : 0.0;

                $lines = [];
                $refundBase = 0.0;
                $refundTax = 0.0;

                foreach ($data['items'] as $row) {
                    $qty = (float) $row['quantity'];
                    if ($qty <= 0) {
                        continue;
                    }

                    $saleItem = $sale->items->firstWhere('id', $row['sale_item_id']);
                    if ($saleItem === null) {
                        throw DomainException::unprocessable('An item does not belong to this sale.', 'RETURN_ITEM_INVALID');
                    }

                    // Decimal-safe: weight/volume items sell & return fractions
                    // (e.g. 2.5 kg) — never truncate to int.
                    $alreadyReturned = (float) SaleReturnItem::query()
                        ->where('sale_item_id', $saleItem->id)
                        ->sum('quantity');

                    $remaining = round((float) $saleItem->quantity - $alreadyReturned, 3);
                    if ($qty > $remaining) {
                        throw DomainException::unprocessable(
                            "Cannot return {$qty} of \"{$saleItem->product_name}\" — only {$remaining} left to return.",
                            'RETURN_QTY_EXCEEDED',
                        );
                    }

                    // Refund the price actually PAID for the returned units, by
                    // CUMULATIVE allocation so sequential partial returns can never
                    // drift past what was paid. Rounding each return in isolation
                    // (netUnit × qty) repeats the same-signed paisa error every
                    // call — three 1-of-3 returns of an 800 line summing to 800.01.
                    // Instead: round the exact cumulative refund for everything
                    // returned so far, then subtract what was already refunded — the
                    // final return absorbs the remainder and the sum lands exact.
                    $linePaid = round((float) $saleItem->line_total * (1 - $discountRatio), 2);
                    $soldQty = (float) $saleItem->quantity;
                    $alreadyRefunded = (float) SaleReturnItem::query()
                        ->where('sale_item_id', $saleItem->id)
                        ->sum('line_total');
                    $cumulativeRefund = $soldQty > 0
                        ? round($linePaid * ($alreadyReturned + $qty) / $soldQty, 2)
                        : $linePaid;
                    $lineTotal = round($cumulativeRefund - $alreadyRefunded, 2);
                    $refundBase = round($refundBase + $lineTotal, 2);

                    // Tax this line carried, prorated to the returned share.
                    // Exclusive: tax sits on TOP of line_total → share × rate.
                    // Inclusive: tax is WITHIN line_total → extract the portion held
                    // inside (line_total − line_total ÷ (1 + rate)).
                    $lineRate = $saleItem->tax_rate !== null ? (float) $saleItem->tax_rate : $fallbackRate;
                    $lineTax = $inclusive
                        ? round($lineTotal - $lineTotal / (1 + $lineRate / 100), 2)
                        : round($lineTotal * $lineRate / 100, 2);
                    $refundTax = round($refundTax + $lineTax, 2);

                    // Serialized returns: resolve the specific serials coming back.
                    // Each must be an active (not-yet-returned) serial on THIS line,
                    // and there must be exactly one per returned unit.
                    $serialIds = [];
                    $serials = $row['serials'] ?? [];
                    if (! empty($serials)) {
                        if (count($serials) !== (int) round($qty)) {
                            throw DomainException::unprocessable(
                                'Enter one serial per returned unit.',
                                'RETURN_SERIAL_COUNT_MISMATCH',
                            );
                        }
                        foreach ($serials as $serial) {
                            $sis = SaleItemSerial::query()
                                ->where('sale_item_id', $saleItem->id)
                                ->where('serial', trim((string) $serial))
                                ->whereNull('returned_at')
                                ->first();
                            if ($sis === null) {
                                throw DomainException::unprocessable(
                                    "Serial \"{$serial}\" isn't an active serial on this item.",
                                    'RETURN_SERIAL_INVALID',
                                );
                            }
                            $serialIds[] = $sis->id;
                        }
                    }

                    $lines[] = [
                        'tenant_id' => $tenantId,
                        'sale_item_id' => $saleItem->id,
                        'product_id' => $saleItem->product_id,
                        'variant_id' => $saleItem->variant_id,
                        'product_name' => $saleItem->product_name,
                        'variant_name' => $saleItem->variant_name,
                        'quantity' => $qty,
                        'unit_price' => (float) $saleItem->unit_price,
                        'line_total' => $lineTotal,
                        '_item_type' => $saleItem->item_type,
                        // Pack sold: restock draws back factor× the returned count.
                        '_unit_factor' => (float) ($saleItem->unit_factor ?? 1),
                        // BOM snapshot captured at sale time (combo/recipe lines);
                        // restocked in preference to the live recipe.
                        '_components' => $saleItem->components,
                        // sale_item_serial ids to mark returned + free in stock.
                        '_serials' => $serialIds,
                    ];
                }

                if (empty($lines)) {
                    throw DomainException::unprocessable('Select at least one item to return.', 'RETURN_EMPTY');
                }

                // Exclusive: the customer paid base + tax, so refund both. Inclusive:
                // they paid the base (tax already inside it) — refund_tax is only the
                // informational portion held within, never added on top again.
                $refundTotal = $inclusive ? $refundBase : round($refundBase + $refundTax, 2);

                // Gap-free, race-safe number from a locked per-tenant counter — a
                // plain count()+1 lets two concurrent returns mint the same RET-.
                $returnNumber = DocumentCounter::formatted($tenantId, 'sale_return', 'RET');

                /** @var SaleReturn $return */
                $return = SaleReturn::query()->create([
                    'tenant_id' => $tenantId,
                    // From the SALE, not from the active branch context: a refund
                    // belongs to the trade it reverses. Handing the cash back at
                    // another branch must not move the takings between them.
                    'branch_id' => $sale->branch_id,
                    'sale_id' => $sale->id,
                    // Named by the caller, or the drawer the person handing the
                    // notes back has open. The returns desk has no field for it
                    // at all, so every cash refund used to leave the till
                    // without the till's arithmetic hearing about it — and the
                    // shift closed OVER by exactly the refund, which reads as a
                    // cashier with extra money and no explanation.
                    'cash_session_id' => $data['cash_session_id'] ?? BooksDrawer::tillFor(Auth::user())?->id,
                    'return_number' => $returnNumber,
                    'idempotency_key' => $data['idempotency_key'] ?? null,
                    'refund_total' => $refundTotal,
                    'refund_tax' => $refundTax,
                    // Written explicitly, not left to the column default: Eloquent
                    // does not hydrate a column the caller never set, so the freshly
                    // created model — and the JSON built from it — would carry null
                    // where the database holds 0.
                    'refund_credit' => 0,
                    'refund_trade_in' => 0,
                    // Refund goes back the way the customer paid, unless overridden.
                    'refund_method' => $data['refund_method'] ?? $sale->payment_method->value,
                    'reason' => $data['reason'] ?? null,
                    'notes' => $data['notes'] ?? null,
                    'returned_at' => now(),
                    'created_by' => auth()->id(),
                ]);

                foreach ($lines as $line) {
                    $itemType = $line['_item_type'];
                    $unitFactor = $line['_unit_factor'];
                    $components = $line['_components'] ?? null;
                    $serialIds = $line['_serials'] ?? [];
                    unset($line['_item_type'], $line['_unit_factor'], $line['_components'], $line['_serials']);
                    $return->items()->create($line);

                    // Serialized return: mark each returned unit's serial as returned
                    // (frees it from the "already sold" guard) and put its registry
                    // row back in stock so it can be sold again.
                    foreach ($serialIds as $sisId) {
                        $sis = SaleItemSerial::query()->whereKey($sisId)->first();
                        if ($sis === null) {
                            continue;
                        }
                        $sis->forceFill(['returned_at' => now()])->save();
                        if ($sis->product_serial_id !== null) {
                            ProductSerial::query()->whereKey($sis->product_serial_id)
                                ->update(['status' => 'in_stock', 'sale_id' => null]);
                        }
                    }

                    // Restock only physical, still-tracked products.
                    $product = $line['product_id'] !== null
                        ? Product::query()->whereKey($line['product_id'])->first()
                        : null;

                    // A returned combo/recipe line restocks from the BOM SNAPSHOT
                    // captured at sale time (per-unit qty × returned count) — immune
                    // to any recipe/combo edit made after the sale. Legacy lines
                    // (sold before the snapshot existed) fall back to the live
                    // composition below.
                    if (! empty($components)) {
                        foreach ($components as $c) {
                            $component = Product::query()->whereKey($c['product_id'])->first();
                            if ($component !== null && $component->type === ItemType::Product && $component->track_inventory) {
                                $this->inventory->adjust([
                                    'product_id' => $c['product_id'],
                                    'variant_id' => $c['variant_id'] ?? null,
                                    'type' => 'in',
                                    'quantity' => round((float) $c['quantity_per_unit'] * (float) $line['quantity'], 3),
                                    'reason' => "Return {$return->return_number} ({$line['product_name']})",
                                    'reference_type' => 'sale_return',
                                    'reference_id' => $return->id,
                                    'idempotency_key' => "return-{$return->id}-{$line['sale_item_id']}-c{$c['product_id']}",
                                    'branch_id' => $sale->branch_id,
                                ]);
                            }
                        }
                    } elseif ($product !== null && $product->isCombo()) {
                        foreach ($product->comboItems()->with('component')->get() as $ci) {
                            $component = $ci->component;
                            if ($component !== null && $component->type === ItemType::Product && $component->track_inventory) {
                                $this->inventory->adjust([
                                    'product_id' => $component->id,
                                    // WHICH size of it. A component with sizes has no stock of
                                    // its own on the parent — that figure is an orphaned
                                    // leftover, always zero — so this used to deduct against
                                    // nothing and refuse the sale on a full shelf.
                                    'variant_id' => $ci->variant_id,
                                    'type' => 'in',
                                    'quantity' => round((float) $ci->quantity * (float) $line['quantity'], 3),
                                    'reason' => "Return {$return->return_number} (deal: {$product->name})",
                                    'reference_type' => 'sale_return',
                                    'reference_id' => $return->id,
                                    'idempotency_key' => "return-{$return->id}-{$line['sale_item_id']}-c{$component->id}",
                                    'branch_id' => $sale->branch_id,
                                ]);
                            }
                        }
                    } elseif ($product !== null && $product->hasRecipe()) {
                        // Returning a made-to-order dish puts its ingredients back
                        // (ingredient qty × returned count) — the mirror of the
                        // recipe depletion at sale time, for the SIZE that was
                        // sold. This is the legacy path (sales older than the BOM
                        // snapshot), and it has to read the same rows the sale
                        // read or a returned Large restores a Small's flour.
                        $soldSize = $line['variant_id'] === null
                            ? null
                            : ProductVariant::query()->whereKey($line['variant_id'])->first();

                        foreach (RecipeFor::rows($product, $soldSize) as $ri) {
                            $ingredient = $ri->ingredient;
                            if ($ingredient !== null && $ingredient->type === ItemType::Product && $ingredient->track_inventory) {
                                $this->inventory->adjust([
                                    'product_id' => $ingredient->id,
                                    'type' => 'in',
                                    'quantity' => round((float) $ri->quantity * (float) $line['quantity'], 3),
                                    'reason' => "Return {$return->return_number} (recipe: {$product->name})",
                                    'reference_type' => 'sale_return',
                                    'reference_id' => $return->id,
                                    'idempotency_key' => "return-{$return->id}-{$line['sale_item_id']}-i{$ingredient->id}",
                                    'branch_id' => $sale->branch_id,
                                ]);
                            }
                        }
                    } elseif ($itemType === ItemType::Product->value && $product !== null && $product->track_inventory) {
                        $this->inventory->adjust([
                            'product_id' => $line['product_id'],
                            'variant_id' => $line['variant_id'],
                            'type' => 'in',
                            'quantity' => round((float) $line['quantity'] * $unitFactor, 3),
                            'reason' => "Return {$return->return_number} (sale {$sale->invoice_number})",
                            'reference_type' => 'sale_return',
                            'reference_id' => $return->id,
                            'idempotency_key' => "return-{$return->id}-{$line['sale_item_id']}",
                            'branch_id' => $sale->branch_id,
                        ]);
                    }
                }

                // Khata symmetry: if this sale was (partly) charged to the
                // customer's credit, the return reduces what they owe — capped at
                // the sale's still-un-reversed charge so repeated partial returns
                // can never over-reverse. Ledger entry carries the sale id.
                // Exchanges opt OUT (skip_credit_reversal — internal-only, never
                // accepted from HTTP): there the returned value funds the
                // replacement sale, so the debt must stay put.
                if ($sale->customer_id !== null && empty($data['skip_credit_reversal'])) {
                    $customer = Customer::query()->whereKey($sale->customer_id)->lockForUpdate()->first();
                    $outstanding = $customer?->outstandingCreditForSale($sale->id) ?? 0.0;
                    $reverse = round(min($refundTotal, $outstanding), 2);
                    if ($customer !== null && $reverse > 0) {
                        $customer->recordCreditPayment(
                            $reverse,
                            'return',
                            $return->return_number,
                            "Return {$return->return_number} against sale {$sale->invoice_number}",
                            $sale->id,
                        );

                        // Record the split so the cashier pays out only the CASH
                        // portion (refund_total − refund_credit) — a khata sale
                        // returned "for cash" must not hand out money the customer
                        // never paid.
                        $return->forceFill(['refund_credit' => $reverse])->save();
                    }
                }

                // Loyalty symmetry: a return claws back the points EARNED on the
                // returned value and gives back the points SPENT on it — both
                // proportional to the refunded fraction of the sale, and capped
                // per-sale so repeated partial returns can never over-reverse.
                if ($sale->customer_id !== null && ((int) $sale->points_earned > 0 || (int) $sale->points_redeemed > 0)) {
                    $saleTotal = (float) $sale->total;
                    $fraction = $saleTotal > 0 ? min(1.0, $refundTotal / $saleTotal) : 1.0;
                    $loyaltyCustomer = Customer::query()->whereKey($sale->customer_id)->lockForUpdate()->first();
                    if ($loyaltyCustomer !== null) {
                        $clawback = min((int) round((int) $sale->points_earned * $fraction), $loyaltyCustomer->loyaltyEarnedReversible($sale->id));
                        $loyaltyCustomer->reverseEarnedPoints($clawback, $sale->id, "Return {$return->return_number}");
                        $giveBack = min((int) round((int) $sale->points_redeemed * $fraction), $loyaltyCustomer->loyaltyRedeemedReversible($sale->id));
                        $loyaltyCustomer->refundRedeemedPoints($giveBack, $sale->id, "Return {$return->return_number}");
                    }
                }

                // Recompute sale status from total returned vs sold. Decimal-safe
                // so a fully-returned weight sale (e.g. 2.5 kg) actually lands on
                // Refunded instead of being stuck at PartiallyRefunded.
                $totalSold = round((float) $sale->items->sum('quantity'), 3);
                $totalReturned = round((float) SaleReturnItem::query()
                    ->whereIn('sale_item_id', $sale->items->pluck('id'))
                    ->sum('quantity'), 3);

                $fullyReturned = $totalReturned >= $totalSold;

                // Trade-in symmetry, and the reason it is deliberately all-or-
                // nothing: you cannot hand back half an old battery.
                //
                // On a FULL return the customer takes their old unit home again —
                // the scrap leaves stock, and the till pays out only the rupees it
                // actually took. Refunding the whole invoice in cash for a battery
                // that was part-paid in scrap turns the counter into a way of
                // converting dead batteries into money.
                //
                // A PARTIAL return leaves the trade-in exactly where it is. The
                // allowance was given against the deal as a whole, and there is no
                // honest fraction of it to give back.
                if ($fullyReturned && (float) $sale->trade_in_total > 0) {
                    $reversedTotal = 0.0;

                    foreach ($sale->tradeIns()->whereNull('reversed_at')->get() as $tradeIn) {
                        if ($tradeIn->product_id !== null) {
                            $this->inventory->adjust([
                                'product_id' => $tradeIn->product_id,
                                'type' => 'out',
                                'quantity' => (float) $tradeIn->quantity,
                                'reason' => "Trade-in returned · {$return->return_number}",
                                'reference_type' => 'sale_trade_in_reversal',
                                'reference_id' => $sale->id,
                                // It may already have gone to the scrap dealer. Never
                                // block the refund on that — negative stock is the
                                // honest reading and prompts a recount.
                                'allow_negative' => true,
                                'branch_id' => $tradeIn->branch_id,
                            ]);
                        }
                        $tradeIn->forceFill(['reversed_at' => now()])->save();
                        $reversedTotal += (float) $tradeIn->total_allowance;
                    }

                    // Never more than the refund itself — a return that came back
                    // for less than the invoice cannot owe a bigger goods slice.
                    $return->forceFill([
                        'refund_trade_in' => round(min($reversedTotal, $refundTotal), 2),
                    ])->save();
                }

                $sale->forceFill([
                    'status' => $fullyReturned ? SaleStatus::Refunded : SaleStatus::PartiallyRefunded,
                ])->save();

                return $return->load('items');
            });
        } catch (QueryException $e) {
            // A concurrent same-key request won the race: its unique-constraint
            // violation means the return already exists — replay it, not a 500.
            if (! empty($data['idempotency_key']) && (string) $e->getCode() === '23000') {
                $existing = SaleReturn::query()
                    ->where('idempotency_key', $data['idempotency_key'])
                    ->first();
                if ($existing !== null) {
                    return $existing->load('items');
                }
            }
            throw $e;
        }
    }
}
