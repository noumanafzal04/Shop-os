<?php

namespace App\Services;

use App\Enums\FulfillmentType;
use App\Enums\OrderStatus;
use App\Enums\RiderDocumentType;
use App\Enums\RiderStatus;
use App\Exceptions\DomainException;
use App\Jobs\TellShopNobodyTookIt;
use App\Jobs\WidenDeliveryOffer;
use App\Models\Order;
use App\Models\Rider;
use App\Models\RiderDocument;
use App\Models\RiderProfile;
use App\Models\RiderSettlement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Geo;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * EVERYTHING A RIDER DOES.
 *
 * ── The one rule this file exists to keep ─────────────────────────────
 *
 * `RiderProfile` is not tenant-scoped and `Order` is. Every query here that
 * crosses from a rider to an order therefore calls `withoutTenancy()` and then
 * fences by hand, and the fence is ALWAYS the same shape: the order's
 * `rider_id` must be one of THIS profile's cards. There is no second way in.
 *
 * That is not a style preference. `BelongsToTenant` is what stops one shop
 * reading another's rows, and a rider request resolves no tenant at all, so
 * the scope protects nothing here. A missed fence is a stranger's home address
 * and phone number on somebody's phone.
 *
 * ── Why the order status enum is untouched ────────────────────────────
 *
 * A rider's leg is recorded as timestamps and drives the EXISTING transitions
 * through `OrderService::advance()`. Adding rider states to `OrderStatus`
 * would have meant every shop's panel, every transition test and the offline
 * till learning a vocabulary that only matters to deliveries.
 */
class RiderService
{
    /**
     * How many jobs one rider may be carrying at once.
     *
     * Riders really do stack deliveries and a limit of one would be a worse
     * lie than a limit of three. It is a cap, not a target: the fourth
     * acceptance is refused with the count in the message so it reads as a
     * rule rather than a fault.
     */
    public const MAX_ACTIVE_JOBS = 3;

    /**
     * ── HOW A DELIVERY IS OFFERED ────────────────────────────────────
     *
     * Nearest first, widening. Each entry is [seconds after the shop accepted,
     * radius in kilometres from the PICKUP].
     *
     * Three kilometres is roughly ten minutes on a motorbike through a
     * Pakistani city, which is the distance at which a rider says yes without
     * thinking about it. Thirty seconds is long enough to look at a phone and
     * short enough that a customer is not waiting on somebody's pocket.
     *
     * The last stage is the trade's own ceiling — see `MAX_RADIUS_KM`.
     */
    public const OFFER_STAGES = [
        [0, 3.0],
        [30, 6.0],
        [90, null],   // null = open it to the trade's full radius
    ];

    /**
     * After this long with nobody, the SHOP is told.
     *
     * Not a failure — a shop that knows at three minutes can ring its own
     * rider, and a shop that finds out when the customer complains cannot.
     */
    public const OFFER_GIVE_UP_SECONDS = 180;

    /**
     * HOW FAR IS WORTH GOING, per trade.
     *
     * Food goes cold, so five kilometres is already generous. A tyre or a book
     * does not, and a rider will happily cross a city for a fee that makes the
     * trip worth it. Keyed on the PRIMARY type, so `grocery` follows `mart`
     * and `restaurant` follows `food` without repeating either.
     */
    public const MAX_RADIUS_KM = [
        'food' => 5.0,
        'pharmacy' => 7.0,
        'mart' => 8.0,
        'retail' => 12.0,
    ];

    /** Anything not named above. */
    public const DEFAULT_MAX_RADIUS_KM = 8.0;

    /** The widest an offer ever gets for this shop. */
    public static function maxRadiusFor(?Tenant $shop): float
    {
        $primary = BusinessTypes::primary($shop?->business_type ?? '');

        return self::MAX_RADIUS_KM[$primary] ?? self::DEFAULT_MAX_RADIUS_KM;
    }

    /** Kept for the board's fallback when an order carries no radius yet. */
    public const POOL_RADIUS_KM = 8.0;

    /**
     * WHAT A JOB PAYLOAD NEEDS LOADED. One list, every reader.
     *
     * Selecting columns by name is how a relation quietly answers null: an
     * attribute that was never selected is indistinguishable from one that is
     * genuinely empty, and `pickupPoint()` falls back to the shop's
     * coordinates — so a list that forgot `latitude` here would put every job
     * out of range with no error anywhere.
     *
     * @var list<string>
     */
    public const JOB_RELATIONS = [
        // `business_type` is here because `maxRadiusFor()` reads it, and a
        // column left out of a named select comes back NULL rather than
        // missing — so the ceiling quietly fell through to the 8km default
        // for every shop, and a retail order handed back came onto the board
        // at eight kilometres instead of twelve. Exactly the failure the note
        // above describes, found by a test that asserted the number.
        'tenant:id,business_name,business_type,slug,phone,latitude,longitude',
        'branch:id,name,address,phone,latitude,longitude',
        'items',
    ];

    public function __construct(private NotificationService $notifications) {}

    // ─────────────────────────────────────────────────────────────────────
    // Becoming a rider
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Start (or restart) an application.
     *
     * A rejected application may be corrected and sent again — that is what a
     * rejection is for. A suspended one may not: that was a decision about the
     * person, and letting them re-apply their way out of it would make the
     * verdict meaningless.
     */
    public function apply(User $user, array $data): RiderProfile
    {
        $existing = RiderProfile::query()->where('user_id', $user->id)->first();

        if ($existing !== null) {
            if ($existing->status === RiderStatus::Suspended) {
                throw DomainException::forbidden(
                    'This account is suspended. Contact support.',
                    'RIDER_SUSPENDED',
                );
            }
            if ($existing->status === RiderStatus::Approved) {
                throw DomainException::conflict('You are already an approved rider.', 'RIDER_ALREADY_APPROVED');
            }

            $existing->forceFill($data + [
                // Back to a draft: the papers may need changing too, and a
                // corrected application that stayed `pending` would sit in the
                // review queue looking like it had already been submitted.
                'status' => RiderStatus::Draft,
                'review_note' => null,
            ])->save();

            return $existing->refresh();
        }

        return DB::transaction(function () use ($user, $data): RiderProfile {
            return RiderProfile::query()->create($data + [
                'user_id' => $user->id,
                'rider_code' => $this->nextRiderCode(),
                'status' => RiderStatus::Draft,
            ]);
        });
    }

    /**
     * The next human-readable rider id.
     *
     * Locked for the length of the transaction, because two people tapping
     * "Apply" in the same second is exactly how a unique index throws in
     * production and never once in a test.
     */
    private function nextRiderCode(): string
    {
        $last = RiderProfile::query()->withTrashed()
            ->orderByDesc('rider_code')
            ->lockForUpdate()
            ->value('rider_code');

        $n = $last !== null ? ((int) substr($last, 4)) + 1 : 1;

        return 'RDR-'.str_pad((string) $n, 6, '0', STR_PAD_LEFT);
    }

    /** Store or replace one identity document. Private disk — see the model. */
    public function uploadDocument(RiderProfile $profile, RiderDocumentType $type, UploadedFile $file): RiderDocument
    {
        if (! $profile->status->isEditable()) {
            throw DomainException::conflict(
                'Your documents can no longer be changed here.',
                'RIDER_DOCS_LOCKED',
            );
        }

        $existing = $profile->documents()->where('type', $type->value)->first();

        // Replace, don't accumulate: the unique index says one current
        // document per type, and an applicant who photographed their thumb
        // needs the retake to BE the answer rather than compete with it.
        $path = $file->store("rider-docs/{$profile->id}", 'local');

        if ($existing !== null) {
            Storage::disk('local')->delete($existing->path);
            $existing->forceFill([
                'path' => $path,
                'original_name' => $file->getClientOriginalName(),
                'size_bytes' => $file->getSize() ?: 0,
                'status' => 'pending',
                'review_note' => null,
            ])->save();

            return $existing->refresh();
        }

        return $profile->documents()->create([
            'type' => $type->value,
            'path' => $path,
            'original_name' => $file->getClientOriginalName(),
            'size_bytes' => $file->getSize() ?: 0,
            'status' => 'pending',
        ]);
    }

    /** Send the application for review. Refused while anything is missing. */
    public function submit(RiderProfile $profile): RiderProfile
    {
        if ($profile->status === RiderStatus::Approved) {
            throw DomainException::conflict('You are already an approved rider.', 'RIDER_ALREADY_APPROVED');
        }
        if (! $profile->status->isEditable()) {
            throw DomainException::forbidden('This application cannot be submitted.', 'RIDER_NOT_SUBMITTABLE');
        }

        $profile->load('documents');
        $missing = $profile->missingDocuments();

        if ($missing !== []) {
            throw DomainException::unprocessable(
                'Still needed: '.implode(', ', array_map(
                    fn (string $t) => RiderDocumentType::from($t)->label(),
                    $missing,
                )).'.',
                'RIDER_DOCS_INCOMPLETE',
            );
        }
        if (blank($profile->cnic)) {
            throw DomainException::unprocessable('Your CNIC number is required.', 'RIDER_CNIC_REQUIRED');
        }

        $profile->forceFill([
            'status' => RiderStatus::Pending,
            'applied_at' => now(),
            'review_note' => null,
        ])->save();

        return $profile->refresh();
    }

    /**
     * A person decides. `approve` | `reject` | `suspend` | `reinstate`.
     *
     * A suspended rider is taken offline in the same write: leaving the switch
     * on would keep them in every availability query the moment the read
     * forgot to ask about status too.
     */
    public function review(RiderProfile $profile, string $verdict, ?string $note, User $admin): RiderProfile
    {
        $status = match ($verdict) {
            'approve' => RiderStatus::Approved,
            'reject' => RiderStatus::Rejected,
            'suspend' => RiderStatus::Suspended,
            'reinstate' => RiderStatus::Approved,
            default => throw DomainException::unprocessable("Unknown verdict {$verdict}.", 'RIDER_BAD_VERDICT'),
        };

        if ($verdict === 'approve' && $profile->status !== RiderStatus::Pending) {
            throw DomainException::conflict(
                'Only a submitted application can be approved.',
                'RIDER_NOT_PENDING',
            );
        }

        $profile->forceFill([
            'status' => $status,
            'review_note' => $note,
            'approved_at' => $status === RiderStatus::Approved ? now() : null,
            'approved_by' => $status === RiderStatus::Approved ? $admin->id : null,
            'is_online' => $status === RiderStatus::Approved ? $profile->is_online : false,
        ])->save();

        $profile->loadMissing('user');
        if ($profile->user !== null) {
            $this->notifications->notify(
                $profile->user,
                "rider.{$status->value}",
                match ($status) {
                    RiderStatus::Approved => 'You are approved to ride',
                    RiderStatus::Rejected => 'Application not approved',
                    default => 'Rider account suspended',
                },
                $note ?? match ($status) {
                    RiderStatus::Approved => 'Go online in the app to start receiving deliveries.',
                    RiderStatus::Rejected => 'Check your documents and apply again.',
                    default => 'Contact support for details.',
                },
                ['rider_profile_id' => $profile->id],
                "rider-{$status->value}-{$profile->id}-".($profile->approved_at?->timestamp ?? now()->timestamp),
            );
        }

        return $profile->refresh();
    }

    // ─────────────────────────────────────────────────────────────────────
    // On duty
    // ─────────────────────────────────────────────────────────────────────

    public function setOnline(RiderProfile $profile, bool $online): RiderProfile
    {
        if (! $profile->status->canRide()) {
            throw DomainException::forbidden(
                'Your rider account is '.strtolower($profile->status->label()).'.',
                'RIDER_NOT_APPROVED',
            );
        }

        // A switch does not undo a promise. Somebody is waiting for the food
        // this rider is holding, and going offline with it would take the job
        // off every screen that could chase it.
        if (! $online && $this->activeJobs($profile)->isNotEmpty()) {
            throw DomainException::conflict(
                'Finish or hand back your current delivery before going offline.',
                'RIDER_HAS_ACTIVE_JOB',
            );
        }

        $profile->forceFill([
            'is_online' => $online,
            'last_seen_at' => $online ? now() : $profile->last_seen_at,
        ])->save();

        return $profile->refresh();
    }

    /** Where they are now. Latest only — no trail, by design. */
    public function ping(RiderProfile $profile, ?float $lat, ?float $lng): RiderProfile
    {
        $profile->forceFill([
            'latitude' => $lat ?? $profile->latitude,
            'longitude' => $lng ?? $profile->longitude,
            'last_seen_at' => now(),
        ])->save();

        return $profile;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Work
    // ─────────────────────────────────────────────────────────────────────

    /** This profile's shop-side cards. The fence — see the class docblock. */
    private function cardIds(RiderProfile $profile): array
    {
        return Rider::withoutTenancy()
            ->where('rider_profile_id', $profile->id)
            ->pluck('id')
            ->all();
    }

    /**
     * The card this rider holds at one shop, made if it is not there yet.
     *
     * A platform rider has no card until the moment they take a job. Creating
     * it here is what keeps `orders.rider_id` the single answer to "who is
     * carrying this" — the panel's rider list, the customer's tracking payload
     * and every existing test go on reading one column.
     */
    private function cardFor(RiderProfile $profile, string $tenantId): Rider
    {
        $card = Rider::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->where('rider_profile_id', $profile->id)
            ->first();

        if ($card !== null) {
            return $card;
        }

        $profile->loadMissing('user');

        return Rider::withoutTenancy()->create([
            'tenant_id' => $tenantId,
            'rider_profile_id' => $profile->id,
            'name' => $profile->user?->name ?? $profile->rider_code,
            'phone' => $profile->user?->phone,
            'is_active' => true,
        ]);
    }

    /** Jobs accepted and not yet delivered. */
    public function activeJobs(RiderProfile $profile): Collection
    {
        $cards = $this->cardIds($profile);
        if ($cards === []) {
            return new Collection;
        }

        return Order::withoutTenancy()
            ->whereIn('rider_id', $cards)
            ->whereNotNull('rider_accepted_at')
            ->whereIn('status', [OrderStatus::Preparing->value, OrderStatus::Confirmed->value, OrderStatus::OutForDelivery->value])
            ->with(self::JOB_RELATIONS)
            ->orderBy('placed_at')
            ->get();
    }

    /**
     * Work this rider may take.
     *
     * Two sources, one list:
     *   1. Handed to them by a shop and not yet answered — their own shops.
     *   2. The platform pool: unassigned delivery orders at shops that have
     *      chosen `delivery_provider = platform`, near enough to be real.
     *
     * A rider at their job limit is offered nothing; showing work that cannot
     * be accepted is a button that always fails.
     */
    public function openOffers(RiderProfile $profile): Collection
    {
        if (! $profile->status->canRide() || ! $profile->is_online) {
            return new Collection;
        }
        if ($this->activeJobs($profile)->count() >= self::MAX_ACTIVE_JOBS) {
            return new Collection;
        }

        $open = [OrderStatus::Confirmed->value, OrderStatus::Preparing->value];
        $with = self::JOB_RELATIONS;

        $cards = $this->cardIds($profile);
        $mine = $cards === [] ? new Collection : Order::withoutTenancy()
            ->whereIn('rider_id', $cards)
            ->whereNull('rider_accepted_at')
            ->whereIn('status', $open)
            ->with($with)
            ->orderBy('placed_at')
            ->get();

        if (! $profile->is_platform) {
            return $mine;
        }

        $pool = Order::withoutTenancy()
            ->whereNull('rider_id')
            ->where('fulfillment_type', FulfillmentType::Delivery->value)
            ->whereIn('status', $open)
            ->whereIn('tenant_id', $this->platformShopIds())
            ->with($with)
            ->orderBy('placed_at')
            ->limit(50)
            ->get();

        // Distance is measured from the rider, and a rider with no fix has not
        // told us where they are — so the pool stays closed rather than
        // opening onto the whole country.
        if ($profile->latitude === null || $profile->longitude === null) {
            return $mine;
        }

        $near = $pool->filter(function (Order $o) use ($profile): bool {
            // Distance to the PICKUP, which is the branch that fills it and,
            // failing that, the shop itself. The order's own latitude is the
            // DROP pin — measuring the rider's reach against it asks whether
            // they are near the customer, which is not the question and put a
            // job eight kilometres out of range for a shop next door.
            [$lat, $lng] = self::pickupPoint($o);
            if ($lat === null || $lng === null) {
                return false;
            }

            // ── THE STAGING, ON THE BOARD ─────────────────────────────
            //
            // The widening used to live only in the notifications: riders
            // further out were TOLD late and still found the job sitting on
            // their board the whole time, so the first rider to open the app
            // took it whatever the distance. A queue with no queue in it.
            //
            // A null radius means the offer is closed — taken, or handed
            // back to the shop. The exception is an order placed before
            // staging existed, which has no `offered_at` either; those keep
            // the old flat radius rather than vanishing off every board on
            // the day this deploys.
            $limit = $o->offer_radius_km !== null
                ? (float) $o->offer_radius_km
                : ($o->offered_at === null ? self::POOL_RADIUS_KM : null);

            if ($limit === null) {
                return false;
            }

            return Geo::distanceKm((float) $profile->latitude, (float) $profile->longitude, (float) $lat, (float) $lng)
                <= $limit;
        });

        return $mine->merge($near)->values();
    }

    /**
     * Where the rider collects. One answer, two readers — this and the view.
     *
     * @return array{0: ?float, 1: ?float}
     */
    public static function pickupPoint(Order $o): array
    {
        $lat = $o->branch?->latitude ?? $o->tenant?->latitude;
        $lng = $o->branch?->longitude ?? $o->tenant?->longitude;

        return [$lat !== null ? (float) $lat : null, $lng !== null ? (float) $lng : null];
    }

    /** @return list<string> tenants that have opted into the platform pool */
    private function platformShopIds(): array
    {
        return Tenant::query()
            ->where('settings->delivery_provider', 'platform')
            ->pluck('id')
            ->all();
    }

    /**
     * Take a job.
     *
     * Locked, because the pool is a race by definition: two riders tapping the
     * same order is the normal case, not the edge one. The row is read inside
     * the transaction with `lockForUpdate`, and the second reader finds it
     * taken rather than overwriting the first.
     */
    public function accept(RiderProfile $profile, string $orderId): Order
    {
        if (! $profile->status->canRide()) {
            throw DomainException::forbidden('Your rider account is not approved.', 'RIDER_NOT_APPROVED');
        }
        if ($this->activeJobs($profile)->count() >= self::MAX_ACTIVE_JOBS) {
            throw DomainException::conflict(
                'You are already carrying '.self::MAX_ACTIVE_JOBS.' orders.',
                'RIDER_JOB_LIMIT',
            );
        }

        return DB::transaction(function () use ($profile, $orderId): Order {
            /** @var Order|null $order */
            $order = Order::withoutTenancy()->lockForUpdate()->find($orderId);

            if ($order === null) {
                throw DomainException::unprocessable('That order no longer exists.', 'ORDER_NOT_FOUND');
            }
            if ($order->fulfillment_type !== FulfillmentType::Delivery) {
                throw DomainException::unprocessable('Only delivery orders have a rider.', 'ORDER_NOT_DELIVERY');
            }
            if (! $order->status->isOpen()) {
                throw DomainException::conflict('That order is already closed.', 'ORDER_NOT_ASSIGNABLE');
            }
            if ($order->rider_accepted_at !== null) {
                throw DomainException::conflict('Another rider has taken this order.', 'ORDER_TAKEN');
            }

            $cards = $this->cardIds($profile);

            if ($order->rider_id !== null && ! in_array($order->rider_id, $cards, strict: true)) {
                throw DomainException::conflict('Another rider has taken this order.', 'ORDER_TAKEN');
            }

            if ($order->rider_id === null) {
                // Pool job. The shop must actually be in the pool — otherwise a
                // rider who learned an id could take any shop's work.
                if (! $profile->is_platform || ! in_array($order->tenant_id, $this->platformShopIds(), strict: true)) {
                    throw DomainException::forbidden('This order is not open to platform riders.', 'ORDER_NOT_IN_POOL');
                }
                $card = $this->cardFor($profile, $order->tenant_id);
                $order->forceFill([
                    'rider_id' => $card->id,
                    'rider_assigned_at' => now(),
                    'rider_self_claimed' => true,
                ]);
            }

            $order->forceFill(['rider_accepted_at' => now()])->save();

            // Off the board, immediately. Without this the job stays on every
            // other rider's screen until they refresh — and they tap it, and
            // are told it is gone, which is the app wasting their time.
            $this->closeOffer($order);

            $this->tellCustomer($order, 'order.rider_assigned', 'Rider on the way',
                ($profile->user?->name ?? 'Your rider')." will deliver order {$order->order_number}.");

            return $order->load('rider', ...self::JOB_RELATIONS);
        });
    }

    /**
     * Hand a job back before collecting it.
     *
     * Clears the card too when the rider took it from the pool, so it returns
     * to the pool rather than sitting assigned to somebody who said no. A shop
     * that assigned it by hand keeps its choice — the shop decides who its own
     * riders are, and silently unassigning would hide a refusal from them.
     */
    public function decline(RiderProfile $profile, string $orderId): Order
    {
        $order = $this->myOrder($profile, $orderId);

        if ($order->picked_up_at !== null) {
            throw DomainException::conflict(
                'You already collected this order — deliver it or call the shop.',
                'ORDER_ALREADY_PICKED_UP',
            );
        }

        $fromPool = (bool) $order->rider_self_claimed;

        $order->forceFill([
            'rider_accepted_at' => null,
            'rider_self_claimed' => false,
            'rider_id' => $fromPool ? null : $order->rider_id,
            'rider_assigned_at' => $fromPool ? null : $order->rider_assigned_at,
        ])->save();

        // Back on the board, at the width the clock has reached. A pool job
        // handed back is a job nobody is carrying, and `accept()` closed the
        // offer when this rider took it.
        if ($fromPool) {
            $this->reopenOffer($order);
        }

        $this->tellShop($order, 'order.rider_declined', 'Rider handed an order back',
            "Order {$order->order_number} needs another rider.");

        return $order;
    }

    /**
     * Collected from the shop.
     *
     * The order moves to out_for_delivery through the SAME transitions the
     * panel uses. A shop that has not pressed "preparing" yet is walked
     * through it — both steps are legal in `OrderStatus::nextStates()`, and a
     * rider standing at the counter with the bag is better evidence that the
     * kitchen finished than a button nobody pressed. Refusing here would mean
     * a forgotten tap in the shop strands a real delivery.
     */
    public function pickUp(RiderProfile $profile, string $orderId, OrderService $orders): Order
    {
        $order = $this->myOrder($profile, $orderId);

        if ($order->picked_up_at !== null) {
            throw DomainException::conflict('You already collected this order.', 'ORDER_ALREADY_PICKED_UP');
        }
        if (! in_array($order->status, [OrderStatus::Confirmed, OrderStatus::Preparing], strict: true)) {
            throw DomainException::conflict(
                'This order cannot be collected while it is '.str_replace('_', ' ', $order->status->value).'.',
                'ORDER_NOT_COLLECTABLE',
            );
        }

        return DB::transaction(function () use ($order, $orders): Order {
            if ($order->status === OrderStatus::Confirmed) {
                $orders->advance($order, OrderStatus::Preparing);
            }
            $orders->advance($order, OrderStatus::OutForDelivery);

            $order->forceFill([
                'picked_up_at' => now(),
                // THE HANDOVER CODE, made here and not a moment earlier.
                // It is the only proof the app has that a delivery marked
                // complete reached the person who paid — and on a cash order
                // that is also when the money moves.
                'delivery_otp' => $order->delivery_otp ?? str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT),
            ])->save();

            $this->tellCustomer($order, 'order.out_for_delivery', 'Your order is on the way',
                "Give the rider code {$order->delivery_otp} when it arrives.");

            return $order->refresh()->load(self::JOB_RELATIONS);
        });
    }

    /**
     * Handed over.
     *
     * The code is checked here and nowhere else. A shop can still complete an
     * order from the panel without one — that is the escape hatch for a
     * customer whose phone is flat — but a rider closing their own job has to
     * prove they were at the door.
     */
    public function deliver(RiderProfile $profile, string $orderId, ?string $otp, OrderService $orders): Order
    {
        $order = $this->myOrder($profile, $orderId);

        if ($order->picked_up_at === null) {
            throw DomainException::conflict('Collect this order before delivering it.', 'ORDER_NOT_PICKED_UP');
        }
        if ($order->status === OrderStatus::Completed) {
            throw DomainException::conflict('This order is already delivered.', 'ORDER_ALREADY_DELIVERED');
        }
        if ($order->delivery_otp !== null && trim((string) $otp) !== $order->delivery_otp) {
            throw DomainException::unprocessable(
                'That code does not match. Ask the customer to read it from their order screen.',
                'ORDER_BAD_OTP',
            );
        }

        return DB::transaction(function () use ($order, $orders): Order {
            // `complete()` writes the sale, releases the hold and marks the
            // order paid. The delivery timestamp is ours; everything else about
            // completing an order stays where it already lived.
            $orders->advance($order, OrderStatus::Completed);
            $order->forceFill(['delivered_at' => now()])->save();

            return $order->refresh();
        });
    }

    /**
     * One of MY orders, or nothing.
     *
     * The fence, in one place, so a new endpoint cannot invent a looser one.
     */
    private function myOrder(RiderProfile $profile, string $orderId): Order
    {
        $cards = $this->cardIds($profile);

        /** @var Order|null $order */
        $order = $cards === [] ? null : Order::withoutTenancy()
            ->whereIn('rider_id', $cards)
            ->whereNotNull('rider_accepted_at')
            ->with(self::JOB_RELATIONS)
            ->find($orderId);

        if ($order === null) {
            throw DomainException::forbidden('That delivery is not yours.', 'ORDER_NOT_YOURS');
        }

        return $order;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Money
    // ─────────────────────────────────────────────────────────────────────

    /**
     * What a rider earned, and what they are still holding.
     *
     * Both DERIVED from the orders. A stored balance is a second copy of a
     * number the orders already answer, and the two drift the first time
     * anything is refunded.
     */
    public function earnings(RiderProfile $profile, ?string $from = null, ?string $to = null): array
    {
        $cards = $this->cardIds($profile);
        if ($cards === []) {
            return ['deliveries' => 0, 'earned' => 0.0, 'cash_in_hand' => 0.0, 'cash_orders' => 0, 'by_shop' => []];
        }

        $delivered = Order::withoutTenancy()
            ->whereIn('rider_id', $cards)
            ->whereNotNull('delivered_at')
            ->when($from !== null, fn ($q) => $q->whereDate('delivered_at', '>=', $from))
            ->when($to !== null, fn ($q) => $q->whereDate('delivered_at', '<=', $to))
            ->with('tenant:id,business_name')
            ->get();

        // Cash in hand ignores the date filter ON PURPOSE. "What am I holding"
        // is a fact about now, not about the week the report is showing, and a
        // rider looking at last month must not be told they owe nothing.
        $holding = Order::withoutTenancy()
            ->whereIn('rider_id', $cards)
            ->whereNotNull('delivered_at')
            ->whereNull('rider_settlement_id')
            ->where('payment_method', 'cod')
            ->with('tenant:id,business_name')
            ->get();

        return [
            'deliveries' => $delivered->count(),
            'earned' => round((float) $delivered->sum(fn (Order $o) => (float) $o->delivery_fee), 2),
            'cash_in_hand' => round((float) $holding->sum(fn (Order $o) => (float) $o->total), 2),
            'cash_orders' => $holding->count(),
            'by_shop' => $holding->groupBy('tenant_id')->map(fn ($rows, $id) => [
                'shop' => $rows->first()->tenant?->business_name,
                'orders' => $rows->count(),
                'cash' => round((float) $rows->sum(fn (Order $o) => (float) $o->total), 2),
            ])->values()->all(),
        ];
    }

    /**
     * The shop counted the cash and took it.
     *
     * Every delivered, unsettled cash order for this rider at THIS shop, in one
     * write. `amount_paid` is what actually changed hands and is recorded
     * rather than recomputed — a shop may round, or hold a deduction back, and
     * the receipt has to say what was really paid.
     */
    public function settle(Tenant $shop, RiderProfile|Rider $rider, User $staff, ?float $amountPaid, ?string $note): RiderSettlement
    {
        $card = $rider instanceof Rider
            ? $rider
            : Rider::withoutTenancy()->where('tenant_id', $shop->id)->where('rider_profile_id', $rider->id)->first();

        if ($card === null || $card->tenant_id !== $shop->id) {
            throw DomainException::unprocessable('That rider does not ride for this shop.', 'RIDER_NOT_OURS');
        }

        return DB::transaction(function () use ($shop, $card, $staff, $amountPaid, $note): RiderSettlement {
            $orders = Order::withoutTenancy()
                ->where('tenant_id', $shop->id)
                ->where('rider_id', $card->id)
                ->whereNotNull('delivered_at')
                ->whereNull('rider_settlement_id')
                ->where('payment_method', 'cod')
                ->lockForUpdate()
                ->get();

            if ($orders->isEmpty()) {
                throw DomainException::unprocessable('This rider is not holding any cash for you.', 'RIDER_NOTHING_TO_SETTLE');
            }

            $cash = round((float) $orders->sum(fn (Order $o) => (float) $o->total), 2);
            $earned = round((float) $orders->sum(fn (Order $o) => (float) $o->delivery_fee), 2);

            $settlement = RiderSettlement::withoutTenancy()->create([
                'tenant_id' => $shop->id,
                'rider_profile_id' => $card->rider_profile_id,
                'rider_id' => $card->id,
                'cash_collected' => $cash,
                'rider_earned' => $earned,
                'amount_paid' => $amountPaid ?? $cash,
                'orders_count' => $orders->count(),
                'note' => $note,
                'settled_by' => $staff->id,
                'settled_at' => now(),
            ]);

            Order::withoutTenancy()->whereIn('id', $orders->pluck('id'))
                ->update(['rider_settlement_id' => $settlement->id]);

            return $settlement;
        });
    }

    // ─────────────────────────────────────────────────────────────────────

    /**
     * TELL A RIDER THERE IS WORK.
     *
     * Nothing did this. A shop assigned an order to a rider and the rider found
     * out by happening to look at their board — which, on a phone in a pocket,
     * is never. The whole rider side rested on somebody staring at a screen.
     *
     * Two audiences, and they are different:
     *
     *   ASSIGNED  one named person, who was chosen. They are told directly.
     *   POOL      every approved platform rider near the shop, none of whom
     *             was chosen. First to accept takes it, and the rest get a
     *             board that no longer lists it.
     *
     * The dedupe key is the ORDER plus the rider, so a job re-offered after a
     * hand-back reaches them again — an order that goes quiet the second time
     * is an order nobody collects.
     */
    public function offerToRider(Order $order, Rider $card): void
    {
        $card->loadMissing('riderProfile.user');
        $user = $card->riderProfile?->user;

        if ($user === null || ! $card->riderProfile->status->canRide()) {
            return; // a phone-call rider has no app to be told on
        }

        $this->notifications->notify(
            $user,
            'rider.job_offered',
            'New delivery',
            $this->offerLine($order),
            ['order_id' => $order->id],
            "rider-offer-{$order->id}-{$card->id}-".now()->timestamp,
        );
    }

    /**
     * OPEN THE OFFER, at whatever width it has reached.
     *
     * Called once when a shop accepts, and again by `WidenDeliveryOffer` at
     * thirty and ninety seconds. Each call notifies only the riders who are
     * NEWLY in range — a rider four hundred metres away who was told at zero
     * seconds does not want the same job announced to them twice more.
     *
     * Returns how many were told, which is what the widening job uses to
     * decide whether saying more is worth another notification.
     */
    public function offerToPool(Order $order, ?float $previousRadius = null): int
    {
        [$lat, $lng] = self::pickupPoint($order);
        if ($lat === null || $lng === null) {
            return 0;
        }

        $radius = (float) ($order->offer_radius_km ?? self::POOL_RADIUS_KM);

        $riders = $this->availableNear($lat, $lng, $radius)
            // Newly in range only. Everyone closer already heard about it.
            ->filter(fn (RiderProfile $p) => $previousRadius === null
                || Geo::distanceKm((float) $p->latitude, (float) $p->longitude, $lat, $lng) > $previousRadius);

        foreach ($riders as $profile) {
            if ($profile->user === null) {
                continue;
            }
            $this->notifications->notify(
                $profile->user,
                'rider.job_offered',
                'New delivery near you',
                $this->offerLine($order),
                ['order_id' => $order->id],
                "rider-pool-{$order->id}-{$profile->id}",
            );
        }

        return $riders->count();
    }

    /**
     * Riders who could actually take a job at this spot.
     *
     * Online, approved, still reporting, within reach, and not already at
     * their limit. Anybody else would be told about work that is not theirs to
     * do — and a rider whose phone buzzes for jobs they cannot take stops
     * reading the buzzes.
     *
     * @return \Illuminate\Support\Collection<int, RiderProfile>
     */
    private function availableNear(float $lat, float $lng, float $radiusKm)
    {
        return RiderProfile::query()
            ->with('user')
            ->where('status', RiderStatus::Approved->value)
            ->where('is_platform', true)
            ->where('is_online', true)
            ->whereNotNull('latitude')
            ->where('last_seen_at', '>', now()->subMinutes(RiderProfile::STALE_AFTER_MINUTES))
            ->get()
            ->filter(fn (RiderProfile $p) => Geo::distanceKm(
                (float) $p->latitude, (float) $p->longitude, $lat, $lng,
            ) <= $radiusKm)
            ->filter(fn (RiderProfile $p) => $this->activeJobs($p)->count() < self::MAX_ACTIVE_JOBS);
    }

    /**
     * START THE CLOCK. Called when a shop accepts a delivery it is not
     * carrying itself.
     *
     * The first stage is written and offered here, synchronously, because a
     * rider three hundred metres away should hear about it before the queue
     * worker has finished waking up. The widening is queued.
     */
    public function beginOffering(Order $order): void
    {
        $order->forceFill([
            'offer_radius_km' => self::OFFER_STAGES[0][1],
            'offered_at' => now(),
        ])->save();

        $this->offerToPool($order);

        WidenDeliveryOffer::dispatch($order->id, 1)
            ->delay(now()->addSeconds(self::OFFER_STAGES[1][0]));

        // Its own timer, not the tail of the widening chain — a chain that
        // ends early because a shop's trade has a low ceiling has not given
        // up, it has run out of places to look. See the job.
        TellShopNobodyTookIt::dispatch($order->id)
            ->delay(now()->addSeconds(self::OFFER_GIVE_UP_SECONDS));
    }

    /**
     * Take an order off the pool board.
     *
     * Called the moment somebody accepts it, and by `decline()` in reverse.
     * Without this a job that has been taken stays on every other rider's
     * board until they refresh — and they tap it, and are told it is gone.
     */
    public function closeOffer(Order $order): void
    {
        $order->forceFill(['offer_radius_km' => null])->save();
    }

    /**
     * PUT IT BACK ON THE BOARD after a rider hands it back.
     *
     * The bug this exists for: `closeOffer()` nulls the radius on accept, and
     * a null radius means "not on the board". A rider who accepted and then
     * declined left the order unassigned, open, and invisible to every board
     * in the city — permanently, because nothing else ever writes that column
     * again. It would have sat there until a shop noticed.
     *
     * It comes back at the WIDEST it had reached, not at three kilometres. The
     * clock has been running the whole time somebody was holding it; narrowing
     * back to the first stage would hide the job from riders who could see it
     * a minute ago, to re-run a countdown that has already finished.
     */
    public function reopenOffer(Order $order): void
    {
        if ($order->offered_at === null) {
            return; // never staged — a shop's own hand-assigned job
        }

        $order->forceFill([
            'offer_radius_km' => self::widestReached($order),
        ])->save();

        $this->offerToPool($order);
    }

    /**
     * How wide the offer had got by now, from the clock rather than a column.
     *
     * Derived, because the stage is derived everywhere else: a stored stage
     * number and a queue that ran late are two clocks, and two clocks
     * disagree.
     */
    public static function widestReached(Order $order): float
    {
        $elapsed = $order->offered_at !== null
            ? $order->offered_at->diffInSeconds(now())
            : 0;

        $radius = self::OFFER_STAGES[0][1];
        foreach (self::OFFER_STAGES as [$after, $km]) {
            if ($elapsed >= $after) {
                $radius = $km ?? self::maxRadiusFor($order->tenant);
            }
        }

        // A trade's ceiling wins over a stage: food never goes past five, even
        // once the last stage has opened it "all the way".
        return min((float) $radius, self::maxRadiusFor($order->tenant));
    }

    /**
     * The one line a rider decides on.
     *
     * The fee first, because that is the decision — a notification that leads
     * with the shop's name asks somebody to open the app to find out whether
     * it is worth opening the app.
     */
    private function offerLine(Order $order): string
    {
        $order->loadMissing('tenant:id,business_name');
        $fee = number_format((float) $order->delivery_fee, 0);

        return "Rs {$fee} · {$order->tenant?->business_name}";
    }

    private function tellCustomer(Order $order, string $type, string $title, string $body): void
    {
        $order->loadMissing('customer');
        if ($order->customer !== null) {
            $this->notifications->notify(
                $order->customer, $type, $title, $body,
                ['order_id' => $order->id],
                "{$type}-{$order->id}",
            );
        }
    }

    private function tellShop(Order $order, string $type, string $title, string $body): void
    {
        $this->notifications->notifyWhoCanAct(
            $order->tenant_id, 'orders.manage', $type, $title, $body,
            ['order_id' => $order->id],
            "{$type}-{$order->id}-".now()->timestamp,
        );
    }
}
