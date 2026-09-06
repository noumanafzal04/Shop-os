<?php

namespace Tests\Feature;

use App\Jobs\TellShopNobodyTookIt;
use App\Jobs\WidenDeliveryOffer;
use App\Models\AppNotification;
use App\Models\City;
use App\Models\Order;
use App\Models\Product;
use App\Models\RiderProfile;
use App\Models\Tenant;
use App\Models\User;
use App\Services\NotificationService;
use App\Services\RiderService;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * NEAREST FIRST, WIDENING.
 *
 * ── What was wrong with the flat board ───────────────────────────────
 *
 * The pool was open: the moment a shop accepted, every platform rider within
 * eight kilometres could see the job and the first to tap took it. The rider
 * four hundred metres away and the rider seven kilometres away had exactly the
 * same claim, so the food went to whoever happened to be looking at their
 * phone — and the customer paid for it in minutes.
 *
 * ── And what was wrong with the half-built fix ───────────────────────
 *
 * The staging was written into the NOTIFICATIONS only. Riders further out were
 * told late and still found the job sitting on their board the whole time, so
 * the ordering existed and changed nothing. This file exists mostly to hold
 * that line: **the board is the offer**, and a notification is a nudge about
 * something the board already says.
 */
class StagedDeliveryOfferTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $customer;

    private User $admin;

    private Product $product;

    /** Lahore, and the shop is the pickup. */
    private const SHOP_LAT = 31.52;

    private const SHOP_LNG = 74.35;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('local');

        $city = City::query()->create([
            'name' => 'Lahore', 'is_active' => true,
            'latitude' => self::SHOP_LAT, 'longitude' => self::SHOP_LNG,
        ]);

        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $city->id,
            // `retail` on purpose: its ceiling is 12km, well above every stage,
            // so a stage is never quietly clamped in the tests that are about
            // stages. The clamp has its own test.
            'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
            'delivery_fee' => 100, 'latitude' => self::SHOP_LAT, 'longitude' => self::SHOP_LNG,
            'settings' => ['delivery_provider' => 'platform'],
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
        $this->admin = User::factory()->superAdmin()->create();

        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice Bag', 'price' => 2000, 'cost' => 1500, 'stock_quantity' => 50, 'track_inventory' => true,
        ]);
    }

    // ── helpers ──────────────────────────────────────────────────────

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function placeDelivery(): array
    {
        return $this->as($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => 'House 12, Johar Town, Lahore',
            'latitude' => 31.47, 'longitude' => 74.27,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');
    }

    private function shopAccepts(string $orderId): void
    {
        $this->as($this->owner)
            ->postJson("/api/v1/orders/{$orderId}/advance", ['status' => 'confirmed'])
            ->assertOk();
    }

    /**
     * A platform rider standing `$km` due north of the shop.
     *
     * North rather than a diagonal because a degree of latitude is 111km
     * everywhere, so the distance in the assertion is the distance on the map
     * — a longitude offset would need the cosine of the latitude and would
     * silently be wrong by fifteen per cent in Lahore.
     */
    private function riderAt(float $km, ?User $user = null): array
    {
        $user ??= User::factory()->create();

        $this->as($user)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => 'bike', 'cnic' => '35202-1234567-1', 'is_platform' => true,
        ])->assertCreated();

        foreach (['cnic_front', 'cnic_back', 'selfie', 'licence'] as $type) {
            $this->as($user)->post('/api/v1/rider/documents', [
                'type' => $type, 'file' => UploadedFile::fake()->image("{$type}.jpg"),
            ])->assertOk();
        }
        $this->as($user)->postJson('/api/v1/rider/submit')->assertOk();

        $profile = RiderProfile::query()->where('user_id', $user->id)->firstOrFail();
        $this->as($this->admin)->postJson("/api/v1/admin/riders/{$profile->id}/review", ['verdict' => 'approve'])
            ->assertOk();

        $this->as($user)->postJson('/api/v1/rider/online', [
            'is_online' => true,
            'latitude' => self::SHOP_LAT + ($km / 111.0),
            'longitude' => self::SHOP_LNG,
        ])->assertOk();

        return [$user, $profile->refresh()];
    }

    /** How many offers this rider's board is showing. */
    private function boardCount(User $user): int
    {
        return count($this->as($user)->getJson('/api/v1/rider/board')->assertOk()->json('data.offers'));
    }

    // ── The opening stage ────────────────────────────────────────────

    public function test_a_shop_accepting_opens_the_offer_at_three_kilometres_and_queues_the_rest(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);

        $row = Order::withoutTenancy()->find($order['id']);
        $this->assertSame(3.0, $row->offer_radius_km);
        $this->assertNotNull($row->offered_at);

        // The widening is queued at thirty seconds — the second stage's own
        // offset — and the give-up notice runs on its own clock.
        Bus::assertDispatched(WidenDeliveryOffer::class, fn ($job) => $job->orderId === $order['id'] && $job->stage === 1);
        Bus::assertDispatched(TellShopNobodyTookIt::class, fn ($job) => $job->orderId === $order['id']);
    }

    public function test_a_shop_that_delivers_for_itself_never_enters_the_pool(): void
    {
        Bus::fake([WidenDeliveryOffer::class]);
        $this->shop->forceFill(['settings' => ['delivery_provider' => 'self']])->save();

        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);

        // The denominator for every assertion above: with the setting off,
        // none of this machinery runs at all.
        $this->assertNull(Order::withoutTenancy()->find($order['id'])->offer_radius_km);
        Bus::assertNotDispatched(WidenDeliveryOffer::class);
    }

    // ── The board IS the offer ───────────────────────────────────────

    public function test_the_board_shows_the_job_only_to_riders_inside_the_current_radius(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        [$near] = $this->riderAt(2.0);
        [$far] = $this->riderAt(5.0);

        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);

        // THE WHOLE POINT. Before this, both riders saw it immediately and the
        // staging lived only in who got a notification first.
        $this->assertSame(1, $this->boardCount($near));
        $this->assertSame(0, $this->boardCount($far));
    }

    public function test_widening_puts_the_job_on_the_further_riders_board(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        [$far] = $this->riderAt(5.0);
        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);
        $this->assertSame(0, $this->boardCount($far));

        (new WidenDeliveryOffer($order['id'], 1))->handle(app(RiderService::class));

        $this->assertSame(6.0, Order::withoutTenancy()->find($order['id'])->offer_radius_km);
        $this->assertSame(1, $this->boardCount($far));
    }

    public function test_a_rider_further_out_than_every_stage_is_never_offered_it(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        // Retail's ceiling is 12km. Fifteen is outside the last stage as well
        // as the first — widening is not the same as giving up on distance.
        [$miles] = $this->riderAt(15.0);
        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);

        foreach ([1, 2] as $stage) {
            (new WidenDeliveryOffer($order['id'], $stage))->handle(app(RiderService::class));
        }

        $this->assertSame(12.0, Order::withoutTenancy()->find($order['id'])->offer_radius_km);
        $this->assertSame(0, $this->boardCount($miles));
    }

    // ── The ceiling ──────────────────────────────────────────────────

    public function test_a_trades_ceiling_beats_a_stage_and_the_offer_never_narrows(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        // Food stops at 5km — below the second stage's 6. The offer must stay
        // where it is rather than being pulled IN from six to five, which
        // would un-offer it to riders who had already been told.
        $this->shop->forceFill([
            'business_type' => 'restaurant',
            'features' => BusinessTypes::defaultFeatures('restaurant'),
        ])->save();

        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);
        Order::withoutTenancy()->whereKey($order['id'])->update(['offer_radius_km' => 6.0]);

        // Stage 1 asks for six, which is where it already is.
        (new WidenDeliveryOffer($order['id'], 1))->handle(app(RiderService::class));
        $this->assertSame(6.0, Order::withoutTenancy()->find($order['id'])->offer_radius_km);

        // Stage 2 asks for "as wide as this trade goes", and for food that is
        // FIVE — below where the offer already stands. Narrowing would take the
        // job back off the board of every rider between five and six
        // kilometres who has already been told about it.
        (new WidenDeliveryOffer($order['id'], 2))->handle(app(RiderService::class));
        $this->assertSame(6.0, Order::withoutTenancy()->find($order['id'])->offer_radius_km);
    }

    public function test_a_job_handed_back_never_comes_back_wider_than_the_trade_allows(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        $this->shop->forceFill([
            'business_type' => 'restaurant',
            'features' => BusinessTypes::defaultFeatures('restaurant'),
        ])->save();

        [$one] = $this->riderAt(1.0);
        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);
        $this->as($one)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();

        // A minute gone: past the second stage's thirty seconds, so the ladder
        // says six — and food never goes past five. The ladder is a schedule,
        // the ceiling is a rule, and the rule wins.
        Order::withoutTenancy()->whereKey($order['id'])->update(['offered_at' => now()->subSeconds(60)]);
        $this->as($one)->postJson("/api/v1/rider/jobs/{$order['id']}/decline")->assertOk();

        $this->assertSame(5.0, Order::withoutTenancy()->find($order['id'])->offer_radius_km);
    }

    public function test_reopening_an_offer_that_was_never_made_does_nothing(): void
    {
        // `reopenOffer` is called on the way out of `decline()`, and the only
        // honest answer for an order nobody ever offered is silence — writing
        // a radius would put a shop's hand-picked delivery onto the open board
        // because its own rider changed their mind.
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);
        Order::withoutTenancy()->whereKey($order['id'])
            ->update(['offer_radius_km' => null, 'offered_at' => null]);

        $row = Order::withoutTenancy()->find($order['id']);
        app(RiderService::class)->reopenOffer($row);

        $this->assertNull($row->fresh()->offer_radius_km);
    }

    public function test_the_last_stage_opens_it_to_the_trades_own_limit(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);

        (new WidenDeliveryOffer($order['id'], 2))->handle(app(RiderService::class));

        // `null` in OFFER_STAGES means "as far as this trade ever goes", and
        // retail goes twelve.
        $this->assertSame(12.0, Order::withoutTenancy()->find($order['id'])->offer_radius_km);
    }

    // ── Every reason a delayed job must stop ─────────────────────────

    public function test_widening_stops_once_somebody_has_taken_it(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        [$near] = $this->riderAt(1.0);
        [$far] = $this->riderAt(5.0);

        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);
        $this->as($near)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();

        // Accepting closes the offer, so the delayed job finds nothing to do —
        // re-widening a closed offer would put a job somebody is already
        // carrying back onto every board in the city.
        $this->assertNull(Order::withoutTenancy()->find($order['id'])->offer_radius_km);

        (new WidenDeliveryOffer($order['id'], 1))->handle(app(RiderService::class));

        $this->assertNull(Order::withoutTenancy()->find($order['id'])->offer_radius_km);
        $this->assertSame(0, $this->boardCount($far));
    }

    public function test_accepting_takes_it_off_every_other_riders_board_at_once(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        [$one] = $this->riderAt(1.0);
        [$two] = $this->riderAt(1.5);

        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);
        $this->assertSame(1, $this->boardCount($two));

        $this->as($one)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();

        // Not "until they refresh and are told it is gone".
        $this->assertSame(0, $this->boardCount($two));
    }

    public function test_widening_stops_when_the_order_is_cancelled(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'cancelled'])->assertOk();

        (new WidenDeliveryOffer($order['id'], 1))->handle(app(RiderService::class));

        $this->assertSame(3.0, Order::withoutTenancy()->find($order['id'])->offer_radius_km);
    }

    public function test_a_closed_offer_is_off_the_board_and_stays_closed(): void
    {
        // The state that is neither "taken" nor "never offered": a shop pulled
        // its order back off the pool. `rider_id` is still null, so the query
        // that finds pool work still returns it — the radius is the ONLY thing
        // saying it is not on offer.
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        [$near] = $this->riderAt(1.0);
        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);
        $this->assertSame(1, $this->boardCount($near));

        app(RiderService::class)->closeOffer(Order::withoutTenancy()->find($order['id']));

        $this->assertSame(0, $this->boardCount($near));

        // …and the widening that was already queued must not re-open it.
        (new WidenDeliveryOffer($order['id'], 1))->handle(app(RiderService::class));

        $this->assertNull(Order::withoutTenancy()->find($order['id'])->offer_radius_km);
        $this->assertSame(0, $this->boardCount($near));
    }

    public function test_the_shop_is_not_told_about_an_offer_it_pulled_back_itself(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);
        app(RiderService::class)->closeOffer(Order::withoutTenancy()->find($order['id']));

        (new TellShopNobodyTookIt($order['id']))->handle(app(NotificationService::class));

        $this->assertFalse(
            AppNotification::query()->where('user_id', $this->owner->id)->where('type', 'order.no_rider')->exists(),
            'a shop was warned that nobody took a delivery it had withdrawn',
        );
    }

    public function test_widening_survives_an_order_that_no_longer_exists(): void
    {
        // A delayed job is a statement about the past. Deleting the row is the
        // bluntest version of "the world moved on" and must not throw.
        (new WidenDeliveryOffer('00000000-0000-0000-0000-000000000000', 1))->handle(app(RiderService::class));
        $this->assertTrue(true);
    }

    public function test_a_stage_past_the_end_of_the_ladder_does_nothing(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);
        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);

        (new WidenDeliveryOffer($order['id'], 99))->handle(app(RiderService::class));

        $this->assertSame(3.0, Order::withoutTenancy()->find($order['id'])->offer_radius_km);
    }

    // ── Handed back ──────────────────────────────────────────────────

    public function test_a_pool_job_handed_back_goes_onto_the_board_again(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        [$one] = $this->riderAt(1.0);
        [$two] = $this->riderAt(1.5);

        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);

        $this->as($one)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();
        $this->as($one)->postJson("/api/v1/rider/jobs/{$order['id']}/decline")->assertOk();

        // THE BUG. `accept()` nulls the radius, and a null radius means "not on
        // the board" — so before `reopenOffer` a job that was taken and handed
        // back was unassigned, open, and invisible to every rider in the city,
        // permanently, because nothing else ever wrote that column again.
        $row = Order::withoutTenancy()->find($order['id']);
        $this->assertNull($row->rider_id);
        $this->assertNotNull($row->offer_radius_km);
        $this->assertSame(1, $this->boardCount($two));
        $this->assertSame(1, $this->boardCount($one));
    }

    public function test_a_job_handed_back_late_comes_back_at_the_width_it_had_reached(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        [$one] = $this->riderAt(1.0);
        [$far] = $this->riderAt(5.0);

        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);
        $this->as($one)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();

        // Two minutes of somebody holding it. The clock does not stop while a
        // rider decides, so narrowing back to three kilometres would hide the
        // job from riders who could see it a minute ago and re-run a countdown
        // that has already finished.
        Order::withoutTenancy()->whereKey($order['id'])->update(['offered_at' => now()->subSeconds(120)]);

        $this->as($one)->postJson("/api/v1/rider/jobs/{$order['id']}/decline")->assertOk();

        $this->assertSame(12.0, Order::withoutTenancy()->find($order['id'])->offer_radius_km);
        $this->assertSame(1, $this->boardCount($far));
    }

    public function test_a_shops_own_hand_picked_rider_handing_back_does_not_open_a_pool_offer(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);
        $this->shop->forceFill(['settings' => ['delivery_provider' => 'self']])->save();

        [$user, $profile] = $this->riderAt(1.0);
        $cardId = $this->as($this->owner)->postJson('/api/v1/riders/invite', ['rider_code' => $profile->rider_code])
            ->assertCreated()->json('data.id');

        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $cardId])->assertOk();
        $this->as($user)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();
        $this->as($user)->postJson("/api/v1/rider/jobs/{$order['id']}/decline")->assertOk();

        // The shop chose this rider. Handing the order to strangers because
        // their own rider is busy is the app overruling a decision the shop
        // made, and `offered_at` being null is what says nobody ever offered it.
        $row = Order::withoutTenancy()->find($order['id']);
        $this->assertNull($row->offered_at);
        $this->assertNull($row->offer_radius_km);
        $this->assertSame($cardId, $row->rider_id);
    }

    // ── Nobody came ──────────────────────────────────────────────────

    public function test_the_shop_is_told_when_nobody_takes_it(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);

        (new TellShopNobodyTookIt($order['id']))->handle(app(NotificationService::class));

        $this->assertTrue(
            AppNotification::query()->where('user_id', $this->owner->id)->where('type', 'order.no_rider')->exists(),
            'the shop was never told nobody had taken the delivery',
        );
    }

    public function test_the_shop_is_not_told_when_somebody_did_take_it(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        [$near] = $this->riderAt(1.0);
        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);
        $this->as($near)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();

        (new TellShopNobodyTookIt($order['id']))->handle(app(NotificationService::class));

        $this->assertFalse(
            AppNotification::query()->where('user_id', $this->owner->id)->where('type', 'order.no_rider')->exists(),
            'a false alarm costs more than the notice is worth',
        );
    }

    // ── The deploy, and the orders already in flight ─────────────────

    public function test_an_order_confirmed_before_staging_existed_stays_on_the_board(): void
    {
        Bus::fake([WidenDeliveryOffer::class, TellShopNobodyTookIt::class]);

        [$rider] = $this->riderAt(4.0);
        $order = $this->placeDelivery();
        $this->shopAccepts($order['id']);

        // What a row looks like on the morning of the deploy: confirmed,
        // unassigned, and with neither column ever written. Dropping these off
        // every board would be this change losing real deliveries.
        Order::withoutTenancy()->whereKey($order['id'])
            ->update(['offer_radius_km' => null, 'offered_at' => null]);

        $this->assertSame(1, $this->boardCount($rider));
    }
}
