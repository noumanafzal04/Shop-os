<?php

namespace App\Services;

use App\Actions\Sale\CreateSaleAction;
use App\Enums\FulfillmentType;
use App\Enums\ItemType;
use App\Enums\OrderStatus;
use App\Exceptions\DomainException;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Rider;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Online order lifecycle. Stock is held at PLACEMENT (decremented through the
 * audited InventoryService), released on cancel, and on completion converted
 * into a Sale — identical stock-safety guarantees to reservations & POS sales.
 *
 * Edge cases:
 *  - double-submit checkout       → idempotency_key replays the same order
 *  - oversell (two orders, last)  → row-locked stock decrement; the loser
 *                                    gets INSUFFICIENT_STOCK, whole order
 *                                    rolls back (no order, no number gap)
 *  - product removed mid-checkout → PRODUCT_UNAVAILABLE, rollback
 *  - illegal status jump          → ORDER_INVALID_TRANSITION
 *  - cancel after completion      → blocked; stock never double-restored
 */
class OrderService
{
    public function __construct(
        private readonly InventoryService $inventory,
        private readonly CreateSaleAction $createSale,
        private readonly NotificationService $notifications,
    ) {
    }

    public function place(User $customer, Tenant $shop, array $data): Order
    {
        if (! $shop->sellsOnline()) {
            throw DomainException::unprocessable('This shop is not accepting online orders.', 'ORDERING_DISABLED');
        }

        // Business hours: shops with a configured schedule don't take orders
        // while closed (shops with no schedule are always orderable).
        if (! $shop->isOpenNow()) {
            throw DomainException::unprocessable(
                'This shop is closed right now — please order during business hours.',
                'SHOP_CLOSED',
            );
        }

        // Fulfillment config: each business chooses pickup / delivery / both.
        $fulfillment = $data['fulfillment_type'];
        if ($fulfillment === FulfillmentType::Delivery->value && ! $shop->deliveryEnabled()) {
            throw DomainException::unprocessable('This shop does not offer delivery.', 'DELIVERY_DISABLED');
        }
        if ($fulfillment === FulfillmentType::Pickup->value && ! $shop->pickupEnabled()) {
            throw DomainException::unprocessable('This shop is delivery-only.', 'PICKUP_DISABLED');
        }

        // Delivery radius: when the shop set one AND both sides have a pin,
        // reject orders outside the shop's coverage (foodpanda-style).
        if ($fulfillment === FulfillmentType::Delivery->value) {
            $radius = $shop->setting('delivery_radius_km');
            if ($radius !== null
                && isset($data['latitude'], $data['longitude'])
                && $shop->latitude !== null && $shop->longitude !== null) {
                $distance = \App\Support\Geo::distanceKm(
                    (float) $data['latitude'], (float) $data['longitude'],
                    (float) $shop->latitude, (float) $shop->longitude,
                );
                if ($distance > (float) $radius) {
                    throw DomainException::unprocessable(
                        "This shop delivers within {$radius} km — your location is ".number_format($distance, 1).' km away.',
                        'OUT_OF_DELIVERY_AREA',
                    );
                }
            }
        }

        // Replay: same key → original order.
        if (! empty($data['idempotency_key'])) {
            $existing = Order::withoutTenancy()
                ->where('tenant_id', $shop->id)
                ->where('idempotency_key', $data['idempotency_key'])
                ->first();
            if ($existing !== null) {
                return $existing->load('items');
            }
        }

        try {
            return DB::transaction(function () use ($customer, $shop, $data, $fulfillment): Order {
            // Serialize order-number generation for this tenant.
            $lockedShop = Tenant::query()->whereKey($shop->id)->lockForUpdate()->first();

            $lines = [];
            $subtotal = 0.0;

            foreach ($data['items'] as $item) {
                /** @var Product|null $product */
                $product = Product::withoutTenancy()
                    ->where('tenant_id', $shop->id)
                    ->where('id', $item['product_id'])
                    ->where('is_active', true)
                    ->where('visible_in_marketplace', true)
                    ->where('type', ItemType::Product)
                    ->lockForUpdate()
                    ->first();

                if ($product === null) {
                    throw DomainException::unprocessable('An item is no longer available.', 'PRODUCT_UNAVAILABLE');
                }

                $variant = null;
                if (! empty($item['variant_id'])) {
                    $variant = ProductVariant::withoutTenancy()
                        ->where('product_id', $product->id)
                        ->where('id', $item['variant_id'])
                        ->where('is_active', true)
                        ->lockForUpdate()
                        ->first();
                    if ($variant === null) {
                        throw DomainException::unprocessable('An option is no longer available.', 'VARIANT_UNAVAILABLE');
                    }
                }

                // Food serving window: a "breakfast 07:00–11:00" item can't be
                // ordered at 20:00. Compared in the shop's own timezone.
                if (! $product->isAvailableNow($shop->timezone)) {
                    throw DomainException::unprocessable(
                        "{$product->name} isn't available right now — it's served "
                        .substr((string) $product->available_from, 0, 5).'–'.substr((string) $product->available_until, 0, 5).'.',
                        'ITEM_NOT_AVAILABLE_NOW',
                    );
                }

                $source = $variant ?? $product;
                $qty = (float) $item['quantity'];

                // Pack-breaking (parity with the POS): an online line may be a
                // defined pack (strip/box). Packs don't combine with variants.
                $unit = null;
                if ($variant === null && ! empty($item['product_unit_id'])) {
                    $unit = \App\Models\ProductUnit::withoutTenancy()
                        ->where('product_id', $product->id)
                        ->where('id', $item['product_unit_id'])
                        ->first();
                    if ($unit === null) {
                        throw DomainException::unprocessable('A pack option is no longer available.', 'UNIT_UNAVAILABLE');
                    }
                }
                $factor = $unit !== null ? (float) $unit->factor : 1.0;

                // Unit-sold items can't be ordered in fractions (only weight/
                // volume items take decimals).
                if ($product->sold_by !== 'weight' && fmod($qty, 1.0) !== 0.0) {
                    throw DomainException::unprocessable(
                        "\"{$product->name}\" is sold by unit — order a whole quantity.",
                        'FRACTIONAL_QTY_NOT_ALLOWED',
                    );
                }

                // Wholesale: enforce the item's minimum order quantity online.
                if ($product->min_order_qty !== null && $qty < (float) $product->min_order_qty) {
                    throw DomainException::unprocessable(
                        "Minimum order quantity for {$product->name} is {$product->min_order_qty}.",
                        'MIN_ORDER_QTY',
                    );
                }

                // Menu modifiers / add-ons: validate selection, add price deltas.
                [$modifierDelta, $modifierSnapshot] = \App\Support\ModifierResolver::resolve(
                    $product,
                    $item['modifier_option_ids'] ?? [],
                );

                // Sale/tier price wins for product-priced lines (qty breaks
                // apply); a pack multiplies the per-base rate (or its own price).
                $basePrice = $variant !== null
                    ? (float) $variant->price
                    : ($unit !== null ? $unit->priceUsing($product->priceForQty($qty)) : $product->priceForQty($qty));
                $unitPrice = round($basePrice + $modifierDelta, 2);
                $lineTotal = round($unitPrice * $qty, 2);
                $subtotal = round($subtotal + $lineTotal, 2);

                $lines[] = compact('product', 'variant', 'unit', 'factor', 'qty') + [
                    'unit_price' => $unitPrice,
                    // Cost tracks base units — a pack's cost is base cost × factor.
                    'unit_cost' => $source->cost !== null ? round((float) $source->cost * $factor, 2) : null,
                    'line_total' => $lineTotal,
                    'modifiers' => $modifierSnapshot,
                ];
            }

            // Delivery economics: minimum basket + free-delivery threshold.
            $deliveryFee = 0.0;
            if ($fulfillment === FulfillmentType::Delivery->value) {
                $minOrder = $lockedShop->setting('min_order_amount');
                if ($minOrder !== null && $subtotal < (float) $minOrder) {
                    throw DomainException::unprocessable(
                        'Minimum order for delivery is '.number_format((float) $minOrder).' — add a bit more to your cart.',
                        'MIN_ORDER_AMOUNT',
                    );
                }

                $deliveryFee = (float) $lockedShop->delivery_fee;
                $freeAbove = $lockedShop->setting('free_delivery_threshold');
                if ($freeAbove !== null && $subtotal >= (float) $freeAbove) {
                    $deliveryFee = 0.0; // earned free delivery
                }
            }

            // Coupon: validate + consume against the item subtotal.
            $discount = 0.0;
            $couponCode = null;
            if (! empty($data['coupon_code'])) {
                $result = app(\App\Services\CouponService::class)->apply($shop->id, $data['coupon_code'], $subtotal);
                $discount = $result['discount'];
                $couponCode = $result['code'];
            }

            $seq = Order::withoutTenancy()->where('tenant_id', $shop->id)->count() + 1;

            /** @var Order $order */
            $order = Order::withoutTenancy()->create([
                'tenant_id' => $shop->id,
                'customer_id' => $customer->id,
                'order_number' => 'ORD-'.str_pad((string) $seq, 6, '0', STR_PAD_LEFT),
                'status' => OrderStatus::Pending,
                'fulfillment_type' => $fulfillment,
                'payment_method' => $data['payment_method'] ?? 'cod',
                'payment_status' => 'unpaid',
                'customer_name' => $customer->name,
                'customer_phone' => $customer->phone,
                'delivery_address' => $data['delivery_address'] ?? null,
                'latitude' => $data['latitude'] ?? null,
                'longitude' => $data['longitude'] ?? null,
                'subtotal' => $subtotal,
                'discount' => $discount,
                'coupon_code' => $couponCode,
                'delivery_fee' => $deliveryFee,
                'total' => round($subtotal - $discount + $deliveryFee, 2),
                'notes' => $data['notes'] ?? null,
                'idempotency_key' => $data['idempotency_key'] ?? null,
                'placed_at' => now(),
            ]);

            foreach ($lines as $line) {
                $order->items()->create([
                    'tenant_id' => $shop->id,
                    'product_id' => $line['product']->id,
                    'variant_id' => $line['variant']?->id,
                    'product_unit_id' => $line['unit']?->id,
                    'product_name' => $line['product']->name,
                    'variant_name' => $line['variant']?->name,
                    'unit_name' => $line['unit']?->name,
                    'modifiers' => $line['modifiers'] ?: null,
                    'quantity' => $line['qty'],
                    'unit_factor' => $line['factor'],
                    'unit_price' => $line['unit_price'],
                    'unit_cost' => $line['unit_cost'],
                    'line_total' => $line['line_total'],
                ]);

                // Hold stock now (audited, row-locked). A deal holds no stock of
                // its own — it draws each component down. Non-inventory items
                // (e.g. food menu items) have nothing to hold — skip them.
                if ($line['product']->isCombo()) {
                    foreach ($line['product']->comboItems()->with('component')->get() as $ci) {
                        $component = $ci->component;
                        if ($component !== null && $component->track_inventory) {
                            $this->inventory->adjust([
                                'product_id' => $component->id,
                                'type' => 'out',
                                'quantity' => round((float) $ci->quantity * $line['qty'], 3),
                                'reason' => "Order {$order->order_number} (deal: {$line['product']->name})",
                                'reference_type' => 'order',
                                'reference_id' => $order->id,
                                'idempotency_key' => "order-{$order->id}-combo-{$line['product']->id}-{$component->id}",
                            ]);
                        }
                    }
                } elseif ($line['product']->track_inventory) {
                    $this->inventory->adjust([
                        'product_id' => $line['product']->id,
                        'variant_id' => $line['variant']?->id,
                        'type' => 'out',
                        // Packs draw base units: pack count × factor.
                        'quantity' => round($line['qty'] * $line['factor'], 3),
                        'reason' => "Order {$order->order_number}",
                        'reference_type' => 'order',
                        'reference_id' => $order->id,
                        'idempotency_key' => "order-{$order->id}-{$line['product']->id}-".($line['variant']?->id ?? 'base'),
                    ]);
                }
            }

            // CRM: capture the buyer into the shop's directory (by phone).
            \App\Models\Customer::capture($shop->id, $customer->phone, $customer->name);

            $this->notifications->notifyTenantOwners(
                $shop, 'order.placed', 'New online order',
                "{$customer->name} placed order {$order->order_number} — {$shop->currencySymbol()} ".number_format($order->total, 0).'.',
                ['order_id' => $order->id],
                "order-placed-{$order->id}",
            );

            return $order->load('items');
            });
        } catch (QueryException $e) {
            // A concurrent same-key order request won the race — return the
            // original order instead of a unique-constraint 500.
            if (! empty($data['idempotency_key']) && (string) $e->getCode() === '23000') {
                $existing = Order::withoutTenancy()
                    ->where('tenant_id', $shop->id)
                    ->where('idempotency_key', $data['idempotency_key'])
                    ->first();
                if ($existing !== null) {
                    return $existing->load('items');
                }
            }
            throw $e;
        }
    }

    public function advance(Order $order, OrderStatus $to): Order
    {
        $allowed = $order->status->nextStates($order->fulfillment_type->value);

        if (! in_array($to, $allowed, strict: true)) {
            throw DomainException::conflict(
                "Cannot move an order from {$order->status->value} to {$to->value}.",
                'ORDER_INVALID_TRANSITION',
            );
        }

        if ($to === OrderStatus::Completed) {
            return $this->complete($order);
        }
        if ($to === OrderStatus::Cancelled) {
            return $this->cancel($order, 'Cancelled by shop');
        }

        $order->forceFill(['status' => $to])->save();
        $this->notifyCustomer($order, "order.{$to->value}", 'Order update',
            "Your order {$order->order_number} is now: ".str_replace('_', ' ', $to->value).'.');

        return $order;
    }

    /**
     * Assign (or clear, with null) the shop's own rider on a delivery order.
     * Model A: no rider app — the shop drives the status; the rider name shows
     * on the customer's tracking. Only open delivery orders can be assigned.
     */
    public function assignRider(Order $order, ?Rider $rider): Order
    {
        if ($order->fulfillment_type !== FulfillmentType::Delivery) {
            throw DomainException::unprocessable('Only delivery orders can have a rider.', 'ORDER_NOT_DELIVERY');
        }
        if (! $order->status->isOpen()) {
            throw DomainException::conflict('This order is closed — a rider can no longer be assigned.', 'ORDER_NOT_ASSIGNABLE');
        }

        $order->forceFill([
            'rider_id' => $rider?->id,
            'rider_assigned_at' => $rider !== null ? now() : null,
        ])->save();

        if ($rider !== null) {
            $this->notifyCustomer($order, 'order.rider_assigned', 'Rider assigned',
                "{$rider->name} will deliver your order {$order->order_number}.");
        }

        return $order->load('rider');
    }

    public function cancel(Order $order, string $reason): Order
    {
        if (! $order->status->isOpen()) {
            throw DomainException::conflict('This order can no longer be cancelled.', 'ORDER_NOT_CANCELLABLE');
        }

        return DB::transaction(function () use ($order, $reason): Order {
            $this->releaseStock($order);

            $order->forceFill([
                'status' => OrderStatus::Cancelled,
                'cancel_reason' => $reason,
            ])->save();

            $this->notifyCustomer($order, 'order.cancelled', 'Order cancelled',
                "Your order {$order->order_number} was cancelled. {$reason}");

            return $order;
        });
    }

    private function complete(Order $order): Order
    {
        return DB::transaction(function () use ($order): Order {
            // Release the hold, then let the Sale re-decrement → net zero,
            // with proper revenue + invoice.
            $this->releaseStock($order);

            // The coupon was validated + consumed at placement — carry its
            // discount into the sale (NOT the coupon code, which would consume
            // a second use). The delivery fee stays on the order: the sale
            // records goods revenue only, so amount_paid equals the sale total
            // exactly and a discounted order can always complete.
            $goodsPaid = round((float) $order->subtotal - (float) $order->discount, 2);

            /** @var Sale $sale */
            $sale = $this->createSale->execute([
                'channel' => 'online',
                'customer_name' => $order->customer_name,
                'customer_phone' => $order->customer_phone,
                'items' => $order->items->map(fn ($i) => [
                    'product_id' => $i->product_id,
                    'variant_id' => $i->variant_id,
                    // Carry the pack so the sale re-decrements base units (and a
                    // deal re-draws its components) exactly as the hold did.
                    'product_unit_id' => $i->product_unit_id,
                    'quantity' => $i->quantity,
                    'unit_price' => (float) $i->unit_price,
                    // Carry the captured modifier snapshot forward — the trusted
                    // path keeps the itemization on the sale line without
                    // re-pricing or re-validating (a required group must not
                    // reject a completing order).
                    'modifiers' => $i->modifiers,
                ])->all(),
                'discount' => (float) $order->discount,
                'payment_method' => $order->payment_method === 'paid' ? 'card' : 'cash',
                'amount_paid' => max(0, $goodsPaid),
                'trusted_prices' => true,
                'notes' => "Online order {$order->order_number}"
                    .($order->coupon_code !== null ? " (coupon {$order->coupon_code})" : ''),
                'idempotency_key' => "order-sale-{$order->id}",
            ]);

            $order->forceFill([
                'status' => OrderStatus::Completed,
                'payment_status' => 'paid',
                'sale_id' => $sale->id,
            ])->save();

            $this->notifyCustomer($order, 'order.completed', 'Order completed',
                "Your order {$order->order_number} is complete. Thank you!");

            return $order->load('sale');
        });
    }

    private function releaseStock(Order $order): void
    {
        foreach ($order->items as $item) {
            /** @var Product|null $product */
            $product = $item->product_id !== null
                ? Product::withoutTenancy()->whereKey($item->product_id)->first()
                : null;

            if ($product === null) {
                continue;
            }

            // A deal restores each held component; a pack restores base units
            // (count × factor). Non-inventory (food) items hold nothing.
            if ($product->isCombo()) {
                foreach ($product->comboItems()->with('component')->get() as $ci) {
                    $component = $ci->component;
                    if ($component !== null && $component->track_inventory) {
                        $this->inventory->adjust([
                            'product_id' => $component->id,
                            'type' => 'in',
                            'quantity' => round((float) $ci->quantity * (float) $item->quantity, 3),
                            'reason' => "Order {$order->order_number} released",
                            'reference_type' => 'order_release',
                            'reference_id' => $order->id,
                            'idempotency_key' => "order-release-{$order->id}-{$item->id}-{$component->id}",
                        ]);
                    }
                }
            } elseif ($product->track_inventory) {
                $this->inventory->adjust([
                    'product_id' => $item->product_id,
                    'variant_id' => $item->variant_id,
                    'type' => 'in',
                    'quantity' => round((float) $item->quantity * (float) ($item->unit_factor ?? 1), 3),
                    'reason' => "Order {$order->order_number} released",
                    'reference_type' => 'order_release',
                    'reference_id' => $order->id,
                    'idempotency_key' => "order-release-{$order->id}-{$item->id}",
                ]);
            }
        }
    }

    private function notifyCustomer(Order $order, string $type, string $title, string $body): void
    {
        if ($order->customer !== null) {
            $this->notifications->notify(
                $order->customer, $type, $title, $body,
                ['order_id' => $order->id],
                "{$type}-{$order->id}",
            );
        }
    }
}
