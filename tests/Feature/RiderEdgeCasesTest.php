<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Order;
use App\Models\Product;
use App\Models\Rider;
use App\Models\RiderProfile;
use App\Models\RiderSettlement;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * THE EDGES.
 *
 * `RiderSideTest` walks the road: apply, be approved, accept, collect, deliver,
 * settle. This file is everything either side of it — the refusals, the
 * boundaries, the second shop, the phone that stopped reporting, the document
 * uploaded twice.
 *
 * They are separated because they read differently. The happy path is a story
 * somebody can follow; these are twenty-two independent claims about what the
 * system will NOT do, and mixing them makes both harder to read.
 */
class RiderEdgeCasesTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private Tenant $other;

    private User $owner;

    private User $otherOwner;

    private User $customer;

    private User $rider;

    private User $admin;

    private Product $product;

    private Product $otherProduct;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('local');

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true, 'latitude' => 31.52, 'longitude' => 74.35]);

        $this->shop = $this->makeShop($city->id, 31.52, 74.35);
        // Far enough to be outside POOL_RADIUS_KM (8 km) — Sheikhupura is ~35km.
        $this->other = $this->makeShop($city->id, 31.71, 73.98);

        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->otherOwner = User::factory()->shopOwner($this->other)->create();
        $this->customer = User::factory()->create();
        $this->rider = User::factory()->create(['name' => 'Bilal Khan']);
        $this->admin = User::factory()->superAdmin()->create();

        $this->product = $this->makeProduct($this->shop);
        $this->otherProduct = $this->makeProduct($this->other);
    }

    // ── plumbing ─────────────────────────────────────────────────────

    private function makeShop(string $cityId, float $lat, float $lng): Tenant
    {
        return Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $cityId,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery'),
            'delivery_fee' => 100, 'latitude' => $lat, 'longitude' => $lng,
        ]);
    }

    private function makeProduct(Tenant $shop): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice Bag', 'price' => 2000, 'cost' => 1500, 'stock_quantity' => 50, 'track_inventory' => true,
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function place(?Tenant $shop = null, string $fulfillment = 'delivery', string $payment = 'cod'): array
    {
        $shop ??= $this->shop;
        $product = $shop->is($this->shop) ? $this->product : $this->otherProduct;

        return $this->as($this->customer)->postJson('/api/v1/customer/orders', array_filter([
            'shop_slug' => $shop->slug,
            'fulfillment_type' => $fulfillment,
            'delivery_address' => $fulfillment === 'delivery' ? 'House 12, Johar Town, Lahore' : null,
            'latitude' => 31.47, 'longitude' => 74.27,
            'payment_method' => $payment,
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ]))->assertCreated()->json('data');
    }

    private function approvedRider(User $user, bool $platform = false, string $vehicle = 'bike'): RiderProfile
    {
        $this->as($user)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => $vehicle, 'cnic' => '35202-1234567-1', 'is_platform' => $platform,
        ])->assertCreated();

        $needed = $vehicle === 'cycle'
            ? ['cnic_front', 'cnic_back', 'selfie']
            : ['cnic_front', 'cnic_back', 'selfie', 'licence'];

        foreach ($needed as $type) {
            $this->as($user)->post('/api/v1/rider/documents', [
                'type' => $type, 'file' => UploadedFile::fake()->image("{$type}.jpg"),
            ])->assertOk();
        }

        $this->as($user)->postJson('/api/v1/rider/submit')->assertOk();
        $profile = RiderProfile::query()->where('user_id', $user->id)->firstOrFail();
        $this->as($this->admin)->postJson("/api/v1/admin/riders/{$profile->id}/review", ['verdict' => 'approve'])->assertOk();
        $this->as($user)->postJson('/api/v1/rider/online', [
            'is_online' => true, 'latitude' => 31.52, 'longitude' => 74.35,
        ])->assertOk();

        return $profile->refresh();
    }

    private function link(RiderProfile $profile, ?User $owner = null): string
    {
        return $this->as($owner ?? $this->owner)
            ->postJson('/api/v1/riders/invite', ['rider_code' => $profile->rider_code])
            ->assertCreated()->json('data.id');
    }

    /** Confirm, assign, accept — an order in a rider's hands, ready to collect. */
    private function inHand(array $order, string $cardId, User $rider, ?User $owner = null): void
    {
        $owner ??= $this->owner;
        $this->as($owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $cardId])->assertOk();
        $this->as($rider)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();
    }

    /** …and delivered, code and all. */
    private function deliver(array $order, User $rider): void
    {
        $this->as($rider)->postJson("/api/v1/rider/jobs/{$order['id']}/pick-up")->assertOk();
        $otp = Order::withoutTenancy()->find($order['id'])->delivery_otp;
        $this->as($rider)->postJson("/api/v1/rider/jobs/{$order['id']}/deliver", ['code' => $otp])->assertOk();
    }

    // ── Identity ─────────────────────────────────────────────────────

    public function test_a_rider_keeps_their_id_when_they_apply_again(): void
    {
        // The rider code is printed on their screen and typed into shops. If a
        // corrected application minted a new one, every shop that already added
        // them would be holding a code for nobody.
        $this->as($this->rider)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => 'bike', 'cnic' => '35202-1234567-1',
        ])->assertCreated()->assertJsonPath('data.rider_code', 'RDR-000001');

        $profile = RiderProfile::query()->where('user_id', $this->rider->id)->firstOrFail();
        $this->as($this->admin)->postJson("/api/v1/admin/riders/{$profile->id}/review", [
            'verdict' => 'reject', 'note' => 'CNIC out of focus.',
        ])->assertOk();

        $this->as($this->rider)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => 'car', 'cnic' => '35202-1234567-1',
        ])->assertCreated()
            ->assertJsonPath('data.rider_code', 'RDR-000001')
            ->assertJsonPath('data.vehicle_type', 'car')
            // Back to a draft: a corrected application that stayed `pending`
            // would sit in the queue looking like it had already been sent.
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.review_note', null);

        $this->assertSame(1, RiderProfile::query()->count());
    }

    public function test_two_riders_get_two_different_ids(): void
    {
        $this->as($this->rider)->postJson('/api/v1/rider/apply', ['vehicle_type' => 'bike', 'cnic' => '35202-1234567-1'])
            ->assertCreated()->assertJsonPath('data.rider_code', 'RDR-000001');

        $this->as(User::factory()->create())->postJson('/api/v1/rider/apply', ['vehicle_type' => 'cycle', 'cnic' => '35202-7654321-9'])
            ->assertCreated()->assertJsonPath('data.rider_code', 'RDR-000002');
    }

    public function test_a_cnic_that_is_not_a_cnic_is_refused(): void
    {
        $this->as($this->rider)->postJson('/api/v1/rider/apply', ['vehicle_type' => 'bike', 'cnic' => '123'])
            ->assertStatus(422)->assertJsonValidationErrors('cnic');

        // Dashes optional, because that is how people type it.
        $this->as($this->rider)->postJson('/api/v1/rider/apply', ['vehicle_type' => 'bike', 'cnic' => '3520212345671'])
            ->assertCreated()->assertJsonPath('data.cnic_last4', '5671');
    }

    // ── Documents ────────────────────────────────────────────────────

    public function test_uploading_a_document_twice_replaces_it(): void
    {
        $this->as($this->rider)->postJson('/api/v1/rider/apply', ['vehicle_type' => 'bike', 'cnic' => '35202-1234567-1'])->assertCreated();

        $this->as($this->rider)->post('/api/v1/rider/documents', [
            'type' => 'cnic_front', 'file' => UploadedFile::fake()->image('thumb.jpg'),
        ])->assertOk();

        $first = RiderProfile::query()->where('user_id', $this->rider->id)->firstOrFail()
            ->documents()->where('type', 'cnic_front')->firstOrFail();

        $this->as($this->rider)->post('/api/v1/rider/documents', [
            'type' => 'cnic_front', 'file' => UploadedFile::fake()->image('better.jpg'),
        ])->assertOk();

        $this->assertSame(1, RiderProfile::query()->first()->documents()->where('type', 'cnic_front')->count());

        // The retake IS the answer, rather than competing with the first — and
        // the old file is gone from disk, not merely unreferenced.
        $again = RiderProfile::query()->first()->documents()->where('type', 'cnic_front')->firstOrFail();
        $this->assertNotSame($first->path, $again->path);
        Storage::disk('local')->assertMissing($first->path);
        Storage::disk('local')->assertExists($again->path);
    }

    public function test_a_turned_down_document_blocks_the_application_again(): void
    {
        $profile = $this->approvedRider($this->rider);

        // Suspend so the papers are editable again, then reject one photograph.
        $this->as($this->admin)->postJson("/api/v1/admin/riders/{$profile->id}/review", [
            'verdict' => 'reject', 'note' => 'Retake the back of the CNIC.',
        ])->assertOk();

        $doc = $profile->documents()->where('type', 'cnic_back')->firstOrFail();
        $this->as($this->admin)->postJson("/api/v1/admin/riders/{$profile->id}/documents/{$doc->id}/review", [
            'status' => 'rejected', 'note' => 'Out of focus.',
        ])->assertOk();

        // A rejected document is not a document you have.
        $this->as($this->rider)->getJson('/api/v1/rider/me')
            ->assertOk()
            ->assertJsonPath('data.profile.missing_documents', ['cnic_back'])
            ->assertJsonPath('data.profile.can_submit', false);

        $this->as($this->rider)->postJson('/api/v1/rider/submit')
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'RIDER_DOCS_INCOMPLETE');
    }

    public function test_an_approved_riders_papers_are_locked(): void
    {
        $this->approvedRider($this->rider);

        $this->as($this->rider)->post('/api/v1/rider/documents', [
            'type' => 'cnic_front', 'file' => UploadedFile::fake()->image('new.jpg'),
        ])->assertStatus(409)->assertJsonPath('meta.error_code', 'RIDER_DOCS_LOCKED');
    }

    public function test_a_rider_cannot_read_another_riders_documents(): void
    {
        $mine = $this->approvedRider($this->rider);
        $doc = $mine->documents()->firstOrFail();

        $stranger = User::factory()->create();
        $this->approvedRider($stranger);

        // These are CNIC photographs on the private disk. `/rider/documents/{id}`
        // reads through the profile relation, so somebody else's id is a 404
        // rather than a file.
        $this->as($stranger)->get("/api/v1/rider/documents/{$doc->id}")->assertNotFound();

        // …and the owner still gets theirs.
        $this->as($this->rider)->get("/api/v1/rider/documents/{$doc->id}")->assertOk();
    }

    // ── Duty ─────────────────────────────────────────────────────────

    public function test_a_rider_whose_phone_stopped_reporting_is_not_online(): void
    {
        // "Online" is a switch they flipped, possibly before the battery died.
        // Availability asks BOTH that and whether the phone is still saying so.
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->link($profile);

        $this->as($this->owner)->getJson('/api/v1/riders')
            ->assertOk()->assertJsonPath('data.0.is_online', true);

        $profile->forceFill(['last_seen_at' => now()->subMinutes(RiderProfile::STALE_AFTER_MINUTES + 1)])->save();

        $this->as($this->owner)->getJson('/api/v1/riders')
            ->assertOk()
            // Still switched on, and no longer reachable. The shop is told the
            // second thing, because that is the one it can act on.
            ->assertJsonPath('data.0.is_online', false)
            ->assertJsonPath('data.0.has_app', true);

        $this->assertNotNull($cardId);
    }

    public function test_a_rider_at_their_limit_is_offered_nothing_more(): void
    {
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->link($profile);

        for ($i = 0; $i < 3; $i++) {
            $this->inHand($this->place(), $cardId, $this->rider);
        }

        $fourth = $this->place();
        $this->as($this->owner)->postJson("/api/v1/orders/{$fourth['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$fourth['id']}/assign-rider", ['rider_id' => $cardId])->assertOk();

        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$fourth['id']}/accept")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'RIDER_JOB_LIMIT');

        // And it is not dangled in front of them either — a button that always
        // fails is worse than no button.
        $this->as($this->rider)->getJson('/api/v1/rider/board')
            ->assertOk()
            ->assertJsonCount(3, 'data.active')
            ->assertJsonCount(0, 'data.offers');
    }

    // ── The pool ─────────────────────────────────────────────────────

    public function test_the_pool_does_not_reach_across_the_city(): void
    {
        $this->other->forceFill(['settings' => ['delivery_provider' => 'platform']])->save();
        $this->shop->forceFill(['settings' => ['delivery_provider' => 'platform']])->save();

        $near = $this->place($this->shop);
        $far = $this->place($this->other);
        $this->as($this->owner)->postJson("/api/v1/orders/{$near['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->otherOwner)->postJson("/api/v1/orders/{$far['id']}/advance", ['status' => 'confirmed'])->assertOk();

        $this->approvedRider($this->rider, platform: true);

        $this->as($this->rider)->getJson('/api/v1/rider/board')
            ->assertOk()
            ->assertJsonCount(1, 'data.offers')
            ->assertJsonPath('data.offers.0.id', $near['id']);
    }

    public function test_a_rider_with_no_fix_gets_no_pool_work(): void
    {
        // Distance is measured FROM the rider. Without a position the pool
        // would open onto the whole country, so it stays shut instead.
        $this->shop->forceFill(['settings' => ['delivery_provider' => 'platform']])->save();
        $order = $this->place();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();

        $profile = $this->approvedRider($this->rider, platform: true);
        $profile->forceFill(['latitude' => null, 'longitude' => null])->save();

        $this->as($this->rider)->getJson('/api/v1/rider/board')
            ->assertOk()->assertJsonCount(0, 'data.offers');
    }

    // ── Refusals along the road ──────────────────────────────────────

    public function test_a_pickup_order_never_reaches_a_rider(): void
    {
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->link($profile);
        $order = $this->place(fulfillment: 'pickup');

        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();

        // The shop cannot even assign one.
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $cardId])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'ORDER_NOT_DELIVERY');

        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'ORDER_NOT_DELIVERY');
    }

    public function test_collecting_walks_the_order_through_the_shops_own_stages(): void
    {
        // The rider is standing at the counter with the bag, and the shop never
        // pressed "preparing". Both steps are legal transitions, so the order
        // is walked through rather than the delivery stranded on a missed tap.
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->link($profile);
        $order = $this->place();
        $this->inHand($order, $cardId, $this->rider);

        $this->assertDatabaseHas('orders', ['id' => $order['id'], 'status' => 'confirmed']);

        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/pick-up")->assertOk();

        $this->assertDatabaseHas('orders', ['id' => $order['id'], 'status' => 'out_for_delivery']);
    }

    public function test_an_order_cannot_be_delivered_twice(): void
    {
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->link($profile);
        $order = $this->place();
        $this->inHand($order, $cardId, $this->rider);
        $this->deliver($order, $this->rider);

        $otp = Order::withoutTenancy()->find($order['id'])->delivery_otp;
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/deliver", ['code' => $otp])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'ORDER_ALREADY_DELIVERED');

        // One sale, not two.
        $this->assertSame(1, Order::withoutTenancy()->whereNotNull('sale_id')->count());
        $this->assertSame(49.0, (float) $this->product->fresh()->stock_quantity);
    }

    public function test_a_rider_cannot_hand_back_a_job_that_is_not_theirs(): void
    {
        $mine = $this->approvedRider($this->rider);
        $cardId = $this->link($mine);
        $order = $this->place();
        $this->inHand($order, $cardId, $this->rider);

        $stranger = User::factory()->create();
        $this->approvedRider($stranger);

        $this->as($stranger)->postJson("/api/v1/rider/jobs/{$order['id']}/decline")
            ->assertForbidden()->assertJsonPath('meta.error_code', 'ORDER_NOT_YOURS');

        $this->assertNotNull(Order::withoutTenancy()->find($order['id'])->rider_accepted_at);
    }

    public function test_cancelling_a_delivery_a_rider_is_carrying_puts_the_stock_back(): void
    {
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->link($profile);
        $order = $this->place();
        $this->inHand($order, $cardId, $this->rider);
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/pick-up")->assertOk();

        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/cancel", ['reason' => 'Customer not reachable'])
            ->assertOk();

        // The hold is released exactly as it always was — a rider in the middle
        // of a delivery changes nothing about what cancelling means.
        $this->assertSame(50.0, (float) $this->product->fresh()->stock_quantity);
        $this->assertDatabaseHas('orders', ['id' => $order['id'], 'status' => 'cancelled']);
    }

    // ── What the customer sees ───────────────────────────────────────

    public function test_the_handover_code_exists_only_while_it_means_something(): void
    {
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->link($profile);
        $order = $this->place();
        $this->inHand($order, $cardId, $this->rider);

        // Accepted, not collected: nothing to read out yet.
        $this->as($this->customer)->getJson("/api/v1/customer/orders/{$order['id']}")
            ->assertOk()
            ->assertJsonPath('data.delivery_otp', null)
            ->assertJsonPath('data.rider.stage', 'to_pickup');

        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/pick-up")->assertOk();
        $otp = Order::withoutTenancy()->find($order['id'])->delivery_otp;

        $this->as($this->customer)->getJson("/api/v1/customer/orders/{$order['id']}")
            ->assertOk()->assertJsonPath('data.delivery_otp', $otp);

        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/deliver", ['code' => $otp])->assertOk();

        // Delivered. A code still on screen is a code somebody can be talked
        // out of over the phone.
        $this->as($this->customer)->getJson("/api/v1/customer/orders/{$order['id']}")
            ->assertOk()
            ->assertJsonPath('data.delivery_otp', null)
            ->assertJsonPath('data.rider.stage', 'delivered');
    }

    public function test_a_riders_position_is_shown_only_while_carrying_and_only_while_fresh(): void
    {
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->link($profile);
        $order = $this->place();
        $this->inHand($order, $cardId, $this->rider);

        // Accepted but not collected — they are going to the SHOP, and where
        // they are is not the customer's business yet.
        $this->as($this->customer)->getJson("/api/v1/customer/orders/{$order['id']}")
            ->assertOk()->assertJsonPath('data.rider.latitude', null);

        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/pick-up")->assertOk();
        $this->as($this->rider)->postJson('/api/v1/rider/ping', ['latitude' => 31.50, 'longitude' => 74.32])->assertOk();

        $this->as($this->customer)->getJson("/api/v1/customer/orders/{$order['id']}")
            ->assertOk()->assertJsonPath('data.rider.latitude', 31.5);

        // The phone went quiet. A stale pin is worse than none: it shows a
        // rider parked somewhere they left ten minutes ago.
        $profile->refresh()->forceFill(['last_seen_at' => now()->subMinutes(RiderProfile::STALE_AFTER_MINUTES + 1)])->save();

        $this->as($this->customer)->getJson("/api/v1/customer/orders/{$order['id']}")
            ->assertOk()
            ->assertJsonPath('data.rider.latitude', null)
            // The name and the stage are still true and still shown.
            ->assertJsonPath('data.rider.name', 'Bilal Khan')
            ->assertJsonPath('data.rider.stage', 'on_the_way');
    }

    // ── The money, at its edges ──────────────────────────────────────

    public function test_one_shop_never_settles_another_shops_cash(): void
    {
        $profile = $this->approvedRider($this->rider);
        $here = $this->link($profile);
        $there = $this->link($profile, $this->otherOwner);

        $mine = $this->place($this->shop);
        $theirs = $this->place($this->other);
        $this->inHand($mine, $here, $this->rider);
        $this->inHand($theirs, $there, $this->rider, $this->otherOwner);
        $this->deliver($mine, $this->rider);
        $this->deliver($theirs, $this->rider);

        // The rider is holding both shops' money and sees one total…
        $this->as($this->rider)->getJson('/api/v1/rider/earnings')
            ->assertOk()
            ->assertJsonPath('data.cash_in_hand', 4200)
            ->assertJsonCount(2, 'data.by_shop');

        // …and each shop sees only its own.
        $this->as($this->owner)->getJson("/api/v1/riders/{$here}/statement")
            ->assertOk()->assertJsonPath('data.cash_in_hand', 2100)->assertJsonCount(1, 'data.orders');

        $this->as($this->owner)->postJson("/api/v1/riders/{$here}/settle")
            ->assertCreated()->assertJsonPath('data.orders_count', 1);

        // Settling here left the other shop's money exactly where it was.
        $this->as($this->otherOwner)->getJson("/api/v1/riders/{$there}/statement")
            ->assertOk()->assertJsonPath('data.cash_in_hand', 2100);

        $this->as($this->rider)->getJson('/api/v1/rider/earnings')
            ->assertOk()->assertJsonPath('data.cash_in_hand', 2100);
    }

    public function test_a_shop_cannot_settle_a_rider_who_does_not_ride_for_it(): void
    {
        $profile = $this->approvedRider($this->rider);
        $here = $this->link($profile);
        $order = $this->place();
        $this->inHand($order, $here, $this->rider);
        $this->deliver($order, $this->rider);

        // `riders` is tenant-scoped, so the other shop cannot even name the
        // card — which is the answer, and it is a 404 rather than a refusal
        // because from over there the row does not exist.
        $this->as($this->otherOwner)->postJson("/api/v1/riders/{$here}/settle")->assertNotFound();

        $this->as($this->rider)->getJson('/api/v1/rider/earnings')
            ->assertOk()->assertJsonPath('data.cash_in_hand', 2100);
    }

    public function test_only_cash_that_was_actually_collected_is_settled(): void
    {
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->link($profile);

        $cash = $this->place(payment: 'cod');
        $prepaid = $this->place(payment: 'paid');
        $this->inHand($cash, $cardId, $this->rider);
        $this->inHand($prepaid, $cardId, $this->rider);
        $this->deliver($cash, $this->rider);
        $this->deliver($prepaid, $this->rider);

        // Two deliveries, two fees earned — one lot of cash.
        $this->as($this->rider)->getJson('/api/v1/rider/earnings')
            ->assertOk()
            ->assertJsonPath('data.deliveries', 2)
            ->assertJsonPath('data.earned', 200)
            ->assertJsonPath('data.cash_in_hand', 2100)
            ->assertJsonPath('data.cash_orders', 1);

        $this->as($this->owner)->postJson("/api/v1/riders/{$cardId}/settle")
            ->assertCreated()
            ->assertJsonPath('data.orders_count', 1)
            ->assertJsonPath('data.cash_collected', '2100.00');
    }

    public function test_the_settlement_records_what_really_changed_hands(): void
    {
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->link($profile);
        $order = $this->place();
        $this->inHand($order, $cardId, $this->rider);
        $this->deliver($order, $this->rider);

        // The shop let the rider keep their fee out of the cash. What was
        // counted and what was handed over are different numbers, and the
        // receipt has to say the second one.
        $this->as($this->owner)->postJson("/api/v1/riders/{$cardId}/settle", [
            'amount_paid' => 2000, 'note' => 'Rider kept his fee',
        ])->assertCreated()
            ->assertJsonPath('data.cash_collected', '2100.00')
            ->assertJsonPath('data.rider_earned', '100.00')
            ->assertJsonPath('data.amount_paid', '2000.00');

        $this->assertDatabaseHas('rider_settlements', [
            'tenant_id' => $this->shop->id,
            'note' => 'Rider kept his fee',
            'orders_count' => 1,
        ]);
    }

    public function test_an_order_settled_once_is_never_settled_again(): void
    {
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->link($profile);
        $first = $this->place();
        $this->inHand($first, $cardId, $this->rider);
        $this->deliver($first, $this->rider);

        $this->as($this->owner)->postJson("/api/v1/riders/{$cardId}/settle")->assertCreated();

        // A second delivery afterwards is its own, separate, outstanding money.
        $second = $this->place();
        $this->inHand($second, $cardId, $this->rider);
        $this->deliver($second, $this->rider);

        $this->as($this->owner)->postJson("/api/v1/riders/{$cardId}/settle")
            ->assertCreated()->assertJsonPath('data.orders_count', 1);

        $this->assertSame(2, RiderSettlement::withoutTenancy()->count());
        $this->assertSame(0, Order::withoutTenancy()
            ->whereNotNull('delivered_at')->whereNull('rider_settlement_id')->where('payment_method', 'cod')->count());
    }

    public function test_todays_earnings_are_todays(): void
    {
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->link($profile);
        $order = $this->place();
        $this->inHand($order, $cardId, $this->rider);
        $this->deliver($order, $this->rider);

        $this->as($this->rider)->getJson('/api/v1/rider/board')
            ->assertOk()->assertJsonPath('data.earnings_today.deliveries', 1);

        // Move the delivery into yesterday. What was EARNED belongs to the day
        // it happened…
        Order::withoutTenancy()->where('id', $order['id'])
            ->update(['delivered_at' => now()->subDay()]);

        $this->as($this->rider)->getJson('/api/v1/rider/board')
            ->assertOk()
            ->assertJsonPath('data.earnings_today.deliveries', 0)
            ->assertJsonPath('data.earnings_today.earned', 0)
            // …but what they are HOLDING is a fact about now, whatever day the
            // report is showing. A rider must never be told they owe nothing.
            ->assertJsonPath('data.earnings_today.cash_in_hand', 2100);
    }

    // ── The context an order is finished in ──────────────────────────

    public function test_an_order_is_finished_as_its_own_shop_at_its_own_branch(): void
    {
        /**
         * THE RULE, PINNED.
         *
         * Completing an order writes a Sale, and the sale path takes both the
         * tenant and the branch from AMBIENT CONTEXT — right for a till, where
         * the person pressing the button is standing in the shop. A rider is
         * not standing anywhere: their request resolves no tenant and no
         * branch at all.
         *
         * So `OrderService` sets both from the ORDER, which has always known
         * them, and puts them back afterwards. Without that, a rider closing a
         * delivery either built a sale with a null tenant id and threw, or —
         * where something else had left a branch behind — took the stock off a
         * completely different shop's shelf.
         *
         * This test is deliberately shaped like the accident: the second
         * shop's owner acts, and THEN the rider finishes the first shop's
         * order. Remove either half of `asShop()` and it fails.
         */
        $profile = $this->approvedRider($this->rider);
        $here = $this->link($profile);
        $there = $this->link($profile, $this->otherOwner);

        $mine = $this->place($this->shop);
        $this->inHand($mine, $here, $this->rider);

        // The other shop's owner is the last person to touch the system.
        $theirs = $this->place($this->other);
        $this->inHand($theirs, $there, $this->rider, $this->otherOwner);

        $this->deliver($mine, $this->rider);

        // One unit off the FIRST shop's shelf, and nothing off the second's
        // beyond its own outstanding hold.
        $this->assertSame(49.0, (float) $this->product->fresh()->stock_quantity);
        $this->assertSame(49.0, (float) $this->otherProduct->fresh()->stock_quantity);

        $done = Order::withoutTenancy()->find($mine['id']);
        $this->assertSame('completed', $done->status->value);
        $this->assertNotNull($done->sale_id);

        // The sale belongs to the shop whose goods it moved, and to the branch
        // that filled the order — not to whoever was in context.
        $sale = Sale::withoutTenancy()->findOrFail($done->sale_id);
        $this->assertSame($this->shop->id, $sale->tenant_id);
        $this->assertSame($done->branch_id, $sale->branch_id);
    }

    // ── A shop with none of this ─────────────────────────────────────

    public function test_a_rider_card_with_no_person_behind_it_holds_cash_the_same_way(): void
    {
        // Model A, all the way through the money. The cousin with a motorbike
        // collects cash too, and the shop needs the same column for them.
        $cardId = $this->as($this->owner)->postJson('/api/v1/riders', ['name' => 'Cousin Asif'])
            ->assertCreated()->json('data.id');

        $order = $this->place();
        foreach (['confirmed', 'preparing', 'out_for_delivery'] as $to) {
            $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => $to])->assertOk();
        }
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $cardId])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'completed'])->assertOk();

        // The shop completed it from the panel, so nothing set `delivered_at` —
        // and cash held is measured from that. This is the honest limit of
        // Model A: without the app there is no moment anybody recorded.
        $this->as($this->owner)->getJson('/api/v1/riders')
            ->assertOk()
            ->assertJsonPath('data.0.has_app', false)
            ->assertJsonPath('data.0.cash_in_hand', 0);

        $this->as($this->owner)->postJson("/api/v1/riders/{$cardId}/settle")
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'RIDER_NOTHING_TO_SETTLE');
    }
}
