<?php

namespace App\Services;

use App\Actions\Sale\CreateSaleAction;
use App\Enums\ItemType;
use App\Enums\ReservationStatus;
use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Reservation;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Support\Facades\DB;

/**
 * Reservation lifecycle. Stock is "locked" by decrementing through
 * InventoryService at ACCEPTANCE — the same audited, row-locked path sales
 * use — and released with idempotent counter-movements.
 *
 * Edge cases:
 *  - multiple customers reserve the last item → both may be pending, but
 *    ACCEPTANCE serializes on the product row lock: first accept wins,
 *    second gets INSUFFICIENT_STOCK
 *  - product sold before acceptance         → INSUFFICIENT_STOCK, stays pending
 *  - owner accepts after expiry             → 409 RESERVATION_EXPIRED
 *  - expiry while customer is paying        → complete re-checks expiry
 *  - customer never arrives (no-show)       → expire command releases stock
 *  - double release (cancel + expiry race)  → idempotency keys make the
 *    stock restore apply exactly once
 */
class ReservationService
{
    public const PENDING_WINDOW_HOURS = 24;   // owner response window

    public const PICKUP_WINDOW_HOURS = 48;    // customer pickup window

    public function __construct(
        private readonly InventoryService $inventory,
        private readonly CreateSaleAction $createSale,
        private readonly NotificationService $notifications,
    ) {}

    // ── Customer actions ────────────────────────────────────────────

    public function create(User $customer, Tenant $shop, array $data): Reservation
    {
        if (! $shop->featureEnabled('reservations')) {
            throw DomainException::unprocessable('This shop does not take reservations.', 'RESERVATIONS_DISABLED');
        }

        /** @var Product|null $product */
        $product = Product::withoutTenancy()
            ->where('tenant_id', $shop->id)
            ->where('is_active', true)
            ->where('visible_in_marketplace', true)
            ->where('type', ItemType::Product)
            ->find($data['product_id']);

        if ($product === null) {
            throw DomainException::unprocessable('This item is not available for reservation.', 'PRODUCT_UNAVAILABLE');
        }

        $variant = null;
        if (! empty($data['variant_id'])) {
            $variant = ProductVariant::withoutTenancy()
                ->where('product_id', $product->id)
                ->where('is_active', true)
                ->find($data['variant_id']);

            if ($variant === null) {
                throw DomainException::unprocessable('This option is not available.', 'VARIANT_UNAVAILABLE');
            }
        }

        $source = $variant ?? $product;
        $quantity = (int) $data['quantity'];

        // Soft availability check — the hard, locked check happens at acceptance.
        if ($product->track_inventory && $source->stock_quantity < $quantity) {
            throw DomainException::unprocessable('Not enough stock available to reserve.', 'INSUFFICIENT_STOCK');
        }

        $reservation = Reservation::query()->create([
            'tenant_id' => $shop->id,
            'customer_id' => $customer->id,
            'product_id' => $product->id,
            'variant_id' => $variant?->id,
            'product_name' => $product->name,
            'variant_name' => $variant?->name,
            'unit_price' => $source->price,
            'quantity' => $quantity,
            'status' => ReservationStatus::Pending,
            'notes' => $data['notes'] ?? null,
            'expires_at' => now()->addHours(self::PENDING_WINDOW_HOURS),
        ]);

        // Whoever answers reservations. An owner is not always the person
        // standing at the counter when somebody asks to hold an item.
        $this->notifications->notifyWhoCanAct(
            $shop,
            Permissions::RESERVATIONS_MANAGE,
            'reservation.created',
            'New reservation request',
            "{$customer->name} wants {$quantity} × {$product->name}.",
            ['reservation_id' => $reservation->id],
            "reservation-created-{$reservation->id}",
        );

        return $reservation;
    }

    public function cancelByCustomer(Reservation $reservation): Reservation
    {
        if (! in_array($reservation->status, [ReservationStatus::Pending, ReservationStatus::Accepted], strict: true)) {
            throw DomainException::conflict('This reservation can no longer be cancelled.', 'RESERVATION_NOT_CANCELLABLE');
        }

        return DB::transaction(function () use ($reservation): Reservation {
            if ($reservation->status === ReservationStatus::Accepted) {
                $this->releaseStock($reservation, 'Customer cancelled reservation');
            }

            $reservation->forceFill(['status' => ReservationStatus::Cancelled])->save();

            return $reservation;
        });
    }

    // ── Owner actions ───────────────────────────────────────────────

    public function accept(Reservation $reservation): Reservation
    {
        $this->guardTransition($reservation, from: ReservationStatus::Pending);

        return DB::transaction(function () use ($reservation): Reservation {
            // The hard check: locks the product row. Sold out in the meantime
            // → INSUFFICIENT_STOCK and the reservation STAYS pending.
            // Non-inventory items carry no stock, so there is nothing to hold.
            $product = $reservation->product_id !== null
                ? Product::withoutTenancy()->whereKey($reservation->product_id)->first()
                : null;

            if ($product !== null && $product->track_inventory) {
                $this->inventory->adjust([
                    'product_id' => $reservation->product_id,
                    'variant_id' => $reservation->variant_id,
                    'type' => 'out',
                    'quantity' => $reservation->quantity,
                    'reason' => 'Reservation hold',
                    'reference_type' => 'reservation',
                    'reference_id' => $reservation->id,
                    'idempotency_key' => "reserve-{$reservation->id}",
                ]);
            }

            $reservation->forceFill([
                'status' => ReservationStatus::Accepted,
                'accepted_at' => now(),
                'expires_at' => now()->addHours(self::PICKUP_WINDOW_HOURS),
            ])->save();

            if ($reservation->customer !== null) {
                $this->notifications->notify(
                    $reservation->customer,
                    'reservation.accepted',
                    'Reservation confirmed!',
                    "{$reservation->product_name} is on hold for you — pick it up before ".
                        $reservation->expires_at->format('D, M j g:i A').'.',
                    ['reservation_id' => $reservation->id],
                    "reservation-accepted-{$reservation->id}",
                );
            }

            return $reservation;
        });
    }

    public function reject(Reservation $reservation, ?string $reason = null): Reservation
    {
        if (! in_array($reservation->status, [ReservationStatus::Pending, ReservationStatus::Accepted], strict: true)) {
            throw DomainException::conflict('Only pending or accepted reservations can be rejected.', 'RESERVATION_NOT_REJECTABLE');
        }

        return DB::transaction(function () use ($reservation, $reason): Reservation {
            if ($reservation->status === ReservationStatus::Accepted) {
                $this->releaseStock($reservation, 'Reservation rejected');
            }

            $reservation->forceFill([
                'status' => ReservationStatus::Rejected,
                'reject_reason' => $reason,
            ])->save();

            if ($reservation->customer !== null) {
                $this->notifications->notify(
                    $reservation->customer,
                    'reservation.rejected',
                    'Reservation declined',
                    "Sorry — {$reservation->product_name} couldn't be reserved.".
                        ($reason ? " Reason: {$reason}" : ''),
                    ['reservation_id' => $reservation->id],
                    "reservation-rejected-{$reservation->id}",
                );
            }

            return $reservation;
        });
    }

    /**
     * Customer arrived → convert the hold into a real sale. Net stock effect
     * is zero (release + sale decrement) with a complete audit trail.
     */
    public function complete(Reservation $reservation, array $payment): Reservation
    {
        $this->guardTransition($reservation, from: ReservationStatus::Accepted);

        return DB::transaction(function () use ($reservation, $payment): Reservation {
            $this->releaseStock($reservation, 'Reservation converted to sale');

            /** @var Sale $sale */
            $sale = $this->createSale->execute([
                'channel' => 'online',
                'customer_name' => $reservation->customer?->name,
                'customer_phone' => $reservation->customer?->phone,
                'items' => [[
                    'product_id' => $reservation->product_id,
                    'variant_id' => $reservation->variant_id,
                    'quantity' => $reservation->quantity,
                    // Honor the price promised at reservation time.
                    'unit_price' => (float) $reservation->unit_price,
                ]],
                'trusted_prices' => true,
                // A reservation is a HOLD, collected in person — this method is
                // called the moment the customer walks in. The channel says
                // `online` because that is where they reserved it; the rupees
                // are handed across this counter, so the open drawer must
                // expect them or the cashier closes short by the whole
                // collection. See BooksDrawer::tillFor.
                'collected_at_the_counter' => true,
                // The reservation promised unit_price × quantity, tax-free —
                // charge exactly that at pickup (no recomputed tax on top).
                'tax' => 0.0,
                'payment_method' => $payment['payment_method'],
                'amount_paid' => $payment['amount_paid'],
                'notes' => "Reservation {$reservation->id}",
                'idempotency_key' => "reservation-sale-{$reservation->id}",
            ]);

            $reservation->forceFill([
                'status' => ReservationStatus::Completed,
                'sale_id' => $sale->id,
            ])->save();

            return $reservation->load('sale');
        });
    }

    /**
     * No-show sweeper (scheduler) — also safe to call lazily.
     */
    public function expireOverdue(): int
    {
        $overdue = Reservation::withoutTenancy()
            ->whereIn('status', [ReservationStatus::Pending, ReservationStatus::Accepted])
            ->where('expires_at', '<', now())
            ->get();

        foreach ($overdue as $reservation) {
            DB::transaction(function () use ($reservation): void {
                if ($reservation->status === ReservationStatus::Accepted) {
                    $this->releaseStock($reservation, 'Reservation expired (no-show)');
                }

                $reservation->forceFill(['status' => ReservationStatus::Expired])->save();
            });
        }

        return $overdue->count();
    }

    // ── Internals ───────────────────────────────────────────────────

    private function guardTransition(Reservation $reservation, ReservationStatus $from): void
    {
        if ($reservation->status !== $from) {
            throw DomainException::conflict(
                "This reservation is {$reservation->status->value}, expected {$from->value}.",
                'RESERVATION_INVALID_STATE',
            );
        }

        if ($reservation->isExpired()) {
            throw DomainException::conflict('This reservation has expired.', 'RESERVATION_EXPIRED');
        }
    }

    private function releaseStock(Reservation $reservation, string $reason): void
    {
        // Product may have been deleted meanwhile, or be a non-inventory item
        // — either way there is nothing to restore onto.
        $product = $reservation->product_id !== null
            ? Product::withoutTenancy()->whereKey($reservation->product_id)->first()
            : null;

        if ($product === null || ! $product->track_inventory) {
            return;
        }

        $this->inventory->adjust([
            'product_id' => $reservation->product_id,
            'variant_id' => $reservation->variant_id,
            'type' => 'in',
            'quantity' => $reservation->quantity,
            'reason' => $reason,
            'reference_type' => 'reservation_release',
            'reference_id' => $reservation->id,
            // Exactly-once release even if cancel and expiry race.
            'idempotency_key' => "release-{$reservation->id}",
        ]);
    }
}
