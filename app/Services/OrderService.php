<?php

namespace App\Services;

use App\Actions\Sale\CreateSaleAction;
use App\Enums\FulfillmentType;
use App\Enums\ItemType;
use App\Enums\OrderStatus;
use App\Exceptions\DomainException;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductUnit;
use App\Models\ProductVariant;
use App\Models\Rider;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Geo;
use App\Support\ModifierResolver;
use Illuminate\Database\QueryException;
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
    ) {}

    /**
     * Place an order.
     *
     * Two doors into the same fulfilment chain. A CUSTOMER order arrives from
     * the marketplace and is checked against everything a stranger could get
     * wrong: is the shop online at all, is it open, is the address inside the
     * delivery radius, is the item published.
     *
     * A COUNTER order (`$staff` set) is a phone call or a WhatsApp message
     * taken by a person who is standing in the shop. Every one of those gates
     * is answered by the fact that they picked up:
     *
     *   ONLINE?    a pharmacy that delivers but sells nothing online has
     *              marketplace off. Refusing here would lock out precisely the
     *              shop that needs phone orders most — which is why riders
     *              were already gated on `delivery`, not marketplace.
     *   OPEN?      somebody answered the phone.
     *   RADIUS?    the shopkeeper decides whether they'll go that far. A radius
     *              is a promise to strangers, not a rule for their own staff.
     *   PUBLISHED? `visible_in_marketplace` decides what a stranger may browse.
     *              It has nothing to do with what a shop will sell someone who
     *              rings up and asks for it by name.
     *
     * Everything downstream — pricing, stock holds, coupons, the status
     * machine, riders — is deliberately identical. A phone order that behaved
     * differently from an online one would need its own second implementation
     * of all of it, and the two would drift.
     */
    public function place(?User $customer, Tenant $shop, array $data, ?User $staff = null): Order
    {
        $counter = $staff !== null;

        if (! $counter && ! $shop->sellsOnline()) {
            throw DomainException::unprocessable('This shop is not accepting online orders.', 'ORDERING_DISABLED');
        }

        // Business hours: shops with a configured schedule don't take orders
        // while closed (shops with no schedule are always orderable).
        if (! $counter && ! $shop->isOpenNow()) {
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
        if ($fulfillment === FulfillmentType::Delivery->value && ! $counter) {
            $radius = $shop->setting('delivery_radius_km');
            if ($radius !== null
                && isset($data['latitude'], $data['longitude'])
                && $shop->latitude !== null && $shop->longitude !== null) {
                $distance = Geo::distanceKm(
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
            return DB::transaction(function () use ($customer, $shop, $data, $fulfillment, $staff, $counter): Order {
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
                        // A stranger browsing the storefront sees only what was
                        // published; a shopkeeper on the phone sells anything they
                        // stock, which is what the caller just asked for by name.
                        ->when(! $counter, fn ($q) => $q->where('visible_in_marketplace', true))
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

                    // Prescription items are dispensed in person — a pharmacist
                    // must sight the script. They can be BROWSED online (so the
                    // customer knows the shop stocks them) but never checked out.
                    //
                    // `drug_schedule` is asked too, and not because the flag
                    // above should ever be false on a controlled drug — the
                    // model now guarantees it is not. It is asked because the
                    // TILL refuses on `drug_schedule` and this path refused on
                    // `requires_prescription`, and for as long as those were two
                    // different questions a Schedule-G medicine went out of the
                    // phone-order door with no prescription recorded while the
                    // counter three feet away refused the very same product.
                    //
                    // One question, every path. Two fences reading two fields is
                    // how they drifted in the first place.
                    if ($product->requires_prescription || filled($product->drug_schedule)) {
                        throw DomainException::unprocessable(
                            "{$product->name} requires a prescription — please visit the pharmacy to purchase it.",
                            'RX_IN_PERSON_ONLY',
                        );
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

                    // Eighty-six. Whoever is cooking took this off tonight's
                    // menu, and the till has refused it since the day that
                    // button shipped. One question — MAY THIS BE SOLD RIGHT NOW
                    // — and three places that can start selling an item: this
                    // one, the counter, and AddTicketItemsAction. Only the
                    // counter had ever been asked.
                    //
                    // What makes it worse than an ordinary omission is that
                    // CreateSaleAction EXEMPTS the trusted path from this rule,
                    // and says why: an online order is food the customer
                    // already committed to, so refusing to bill it because the
                    // kitchen has since run out is a shop that cannot close its
                    // own tab. That exemption is only safe if placement
                    // refused first. Placement never did, so the rule was
                    // enforced nowhere for an online order — the kitchen
                    // pressed 86 and the app kept taking orders all evening.
                    //
                    // A counter order is stopped too. `visible_in_marketplace`
                    // is relaxed above for a shopkeeper on the phone because
                    // publishing is the shop's own business; this is not a
                    // publishing decision, it is "there is none left", and
                    // promising it down the phone is the same broken promise.
                    if ($product->isSoldOut()) {
                        throw DomainException::unprocessable(
                            "{$product->name} is sold out.",
                            'ITEM_SOLD_OUT',
                        );
                    }

                    $source = $variant ?? $product;
                    $qty = (float) $item['quantity'];

                    // Pack-breaking (parity with the POS): an online line may be a
                    // defined pack (strip/box). Packs don't combine with variants.
                    $unit = null;
                    if ($variant === null && ! empty($item['product_unit_id'])) {
                        $unit = ProductUnit::withoutTenancy()
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
                    [$modifierDelta, $modifierSnapshot] = ModifierResolver::resolve(
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
                    // The minimum basket is a rule for strangers. A shopkeeper who
                    // agrees to run one packet round the corner has already made
                    // that decision, out loud, on the phone.
                    $minOrder = $counter ? null : $lockedShop->setting('min_order_amount');
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
                    $result = app(CouponService::class)->apply($shop->id, $data['coupon_code'], $subtotal);
                    $discount = $result['discount'];
                    $couponCode = $result['code'];
                }

                $seq = Order::withoutTenancy()->where('tenant_id', $shop->id)->count() + 1;

                /** @var Order $order */
                $order = Order::withoutTenancy()->create([
                    'tenant_id' => $shop->id,
                    'customer_id' => $customer?->id,
                    // Who took the call. When the address turns out to be wrong,
                    // somebody has to be askable.
                    'created_by' => $staff?->id,
                    'order_number' => 'ORD-'.str_pad((string) $seq, 6, '0', STR_PAD_LEFT),
                    'status' => OrderStatus::Pending,
                    'channel' => $counter ? ($data['channel'] ?? 'phone') : 'online',
                    'fulfillment_type' => $fulfillment,
                    'payment_method' => $data['payment_method'] ?? 'cod',
                    'payment_status' => 'unpaid',
                    // A caller has no account, so the name and number come off the
                    // form the staff member filled in while they were talking.
                    'customer_name' => $customer?->name ?? $data['customer_name'],
                    'customer_phone' => $customer?->phone ?? ($data['customer_phone'] ?? null),
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
                    $orderItem = $order->items()->create([
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
                                    // Key by the ORDER-ITEM row, not the product —
                                    // two lines of the same product (or a deal
                                    // added twice) must each hold their own stock,
                                    // and releaseStock keys the same way so the
                                    // release matches the hold exactly.
                                    'idempotency_key' => "order-{$order->id}-item-{$orderItem->id}-c{$component->id}",
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
                            // Per order-item (see combo branch) — duplicate product
                            // lines must not collapse into one hold.
                            'idempotency_key' => "order-{$order->id}-item-{$orderItem->id}",
                        ]);
                    }
                }

                // CRM: capture the buyer into the shop's directory (by phone).
                // This is where a phone caller persists — not as a platform login,
                // which is a different thing entirely and one they never asked for.
                Customer::capture($shop->id, $order->customer_phone, $order->customer_name);

                // A counter order was entered by the shop; telling the owner a
                // "new online order" arrived would be false, and the distinction
                // is the whole point of tracking a channel.
                $this->notifications->notifyTenantOwners(
                    $shop,
                    'order.placed',
                    $counter ? 'New '.($order->channel === 'whatsapp' ? 'WhatsApp' : 'phone').' order' : 'New online order',
                    "{$order->customer_name} — order {$order->order_number} — {$shop->currencySymbol()} ".number_format($order->total, 0).'.',
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
                // Replay the money the customer actually paid at checkout: the
                // order quoted NO tax, so the sale must not invent one — a
                // GST-rated product would otherwise make completion throw
                // PAYMENT_INSUFFICIENT on every taxed order.
                'tax' => 0.0,
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
        // Reverse the exact holds this order placed — read from stock_movements,
        // NOT the live product recipe. A deal's components can be edited between
        // placement and release (SyncComboItemsAction full-replaces them); the
        // recipe read would restore the wrong items. Each hold 'out' becomes an
        // 'in' of the same amount to the same product/variant. Release is
        // whole-order (cancel, or complete-then-re-decrement), so reversing
        // every hold is correct.
        $holds = StockMovement::query()
            ->where('reference_type', 'order')
            ->where('reference_id', $order->id)
            ->where('quantity_change', '<', 0)
            ->get();

        foreach ($holds as $mv) {
            $product = Product::withoutTenancy()->whereKey($mv->product_id)->first();
            if ($product === null || ! $product->track_inventory) {
                continue;
            }

            $this->inventory->adjust([
                'product_id' => $mv->product_id,
                'variant_id' => $mv->variant_id,
                'type' => 'in',
                'quantity' => abs((float) $mv->quantity_change),
                'reason' => "Order {$order->order_number} released",
                'reference_type' => 'order_release',
                'reference_id' => $order->id,
                'idempotency_key' => "order-release-mv-{$mv->id}",
            ]);
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
