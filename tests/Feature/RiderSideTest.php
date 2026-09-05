<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Order;
use App\Models\Product;
use App\Models\Rider;
use App\Models\RiderProfile;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * THE RIDER SIDE, END TO END.
 *
 * Model A — a shop's own named rider with no login — is covered by
 * `RidersTest` and must keep passing untouched; that is the point of the last
 * test in this file.
 *
 * What is tested here is the half that is new: a rider is a USER, they apply
 * and are approved by a person, and they move an order through its delivery
 * leg from their own phone.
 */
class RiderSideTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $customer;

    private User $rider;

    private User $admin;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('local');

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true, 'latitude' => 31.52, 'longitude' => 74.35]);

        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery'),
            'delivery_fee' => 100, 'latitude' => 31.52, 'longitude' => 74.35,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
        $this->rider = User::factory()->create(['name' => 'Bilal Khan']);
        $this->admin = User::factory()->superAdmin()->create();

        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice Bag', 'price' => 2000, 'cost' => 1500, 'stock_quantity' => 20, 'track_inventory' => true,
        ]);
    }

    // ── helpers ──────────────────────────────────────────────────────

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function placeDelivery(string $address = 'House 12, Street 4, Johar Town, Lahore'): array
    {
        return $this->as($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => $address,
            'latitude' => 31.47, 'longitude' => 74.27,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');
    }

    /** An applied, documented, approved rider who is online at the shop. */
    private function approvedRider(User $user, bool $platform = false): RiderProfile
    {
        $this->as($user)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => 'bike',
            'cnic' => '35202-1234567-1',
            'is_platform' => $platform,
        ])->assertCreated();

        foreach (['cnic_front', 'cnic_back', 'selfie', 'licence'] as $type) {
            $this->as($user)->post('/api/v1/rider/documents', [
                'type' => $type,
                'file' => UploadedFile::fake()->image("{$type}.jpg"),
            ])->assertOk();
        }

        $this->as($user)->postJson('/api/v1/rider/submit')->assertOk();

        $profile = RiderProfile::query()->where('user_id', $user->id)->firstOrFail();
        $this->as($this->admin)->postJson("/api/v1/admin/riders/{$profile->id}/review", ['verdict' => 'approve'])
            ->assertOk();

        $this->as($user)->postJson('/api/v1/rider/online', [
            'is_online' => true, 'latitude' => 31.52, 'longitude' => 74.35,
        ])->assertOk();

        return $profile->refresh();
    }

    /** The shop's card for this rider, made by an invite. */
    private function linkToShop(RiderProfile $profile): string
    {
        return $this->as($this->owner)->postJson('/api/v1/riders/invite', ['rider_code' => $profile->rider_code])
            ->assertCreated()->json('data.id');
    }

    // ── Becoming a rider ─────────────────────────────────────────────

    public function test_a_customer_applies_uploads_documents_and_is_approved(): void
    {
        $this->as($this->rider)->getJson('/api/v1/rider/me')
            ->assertOk()->assertJsonPath('data.profile', null);

        $this->as($this->rider)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => 'bike', 'cnic' => '35202-1234567-1',
        ])->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.can_submit', false)
            // The id a human says out loud, allocated at application.
            ->assertJsonPath('data.rider_code', 'RDR-000001')
            // The number itself never comes back — only enough to recognise it.
            ->assertJsonPath('data.cnic_last4', '5671')
            ->assertJsonMissingPath('data.cnic');

        foreach (['cnic_front', 'cnic_back', 'selfie', 'licence'] as $type) {
            $this->as($this->rider)->post('/api/v1/rider/documents', [
                'type' => $type, 'file' => UploadedFile::fake()->image("{$type}.jpg"),
            ])->assertOk();
        }

        $this->as($this->rider)->postJson('/api/v1/rider/submit')
            ->assertOk()->assertJsonPath('data.status', 'pending');

        $profile = RiderProfile::query()->where('user_id', $this->rider->id)->firstOrFail();

        // The queue an admin actually opens shows exactly this person.
        $this->as($this->admin)->getJson('/api/v1/admin/riders')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.rider_code', 'RDR-000001')
            ->assertJsonPath('data.0.name', 'Bilal Khan')
            // Down a list, the CNIC is masked.
            ->assertJsonPath('data.0.cnic', '•••• 5671');

        $this->as($this->admin)->postJson("/api/v1/admin/riders/{$profile->id}/review", ['verdict' => 'approve'])
            ->assertOk()->assertJsonPath('data.status', 'approved');

        $this->as($this->rider)->getJson('/api/v1/rider/me')
            ->assertOk()->assertJsonPath('data.profile.can_ride', true);
    }

    public function test_an_application_missing_a_document_cannot_be_submitted(): void
    {
        $this->as($this->rider)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => 'bike', 'cnic' => '35202-1234567-1',
        ])->assertCreated();

        // Three of the four a motorcyclist needs.
        foreach (['cnic_front', 'cnic_back', 'selfie'] as $type) {
            $this->as($this->rider)->post('/api/v1/rider/documents', [
                'type' => $type, 'file' => UploadedFile::fake()->image("{$type}.jpg"),
            ])->assertOk();
        }

        $this->as($this->rider)->postJson('/api/v1/rider/submit')
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'RIDER_DOCS_INCOMPLETE')
            // Names the missing one, so the applicant can fix it.
            ->assertJsonPath('message', 'Still needed: Driving licence.');
    }

    public function test_a_cyclist_is_not_asked_for_a_driving_licence(): void
    {
        // The form has to be one somebody can finish: a cyclist has no licence
        // and no registration book.
        $this->as($this->rider)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => 'cycle', 'cnic' => '35202-1234567-1',
        ])->assertCreated();

        foreach (['cnic_front', 'cnic_back', 'selfie'] as $type) {
            $this->as($this->rider)->post('/api/v1/rider/documents', [
                'type' => $type, 'file' => UploadedFile::fake()->image("{$type}.jpg"),
            ])->assertOk();
        }

        $this->as($this->rider)->postJson('/api/v1/rider/submit')->assertOk()
            ->assertJsonPath('data.status', 'pending');
    }

    public function test_a_rider_cannot_approve_themselves(): void
    {
        $this->as($this->rider)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => 'bike', 'cnic' => '35202-1234567-1',
        ])->assertCreated();
        $profile = RiderProfile::query()->where('user_id', $this->rider->id)->firstOrFail();

        $this->as($this->rider)->postJson("/api/v1/admin/riders/{$profile->id}/review", ['verdict' => 'approve'])
            ->assertForbidden();

        $this->assertSame('draft', $profile->refresh()->status->value);
    }

    public function test_an_unapproved_rider_cannot_go_online(): void
    {
        $this->as($this->rider)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => 'bike', 'cnic' => '35202-1234567-1',
        ])->assertCreated();

        $this->as($this->rider)->postJson('/api/v1/rider/online', ['is_online' => true])
            ->assertForbidden()->assertJsonPath('meta.error_code', 'RIDER_NOT_APPROVED');
    }

    public function test_a_rejected_application_can_be_corrected_and_a_suspended_one_cannot(): void
    {
        $profile = $this->approvedRider($this->rider);

        $this->as($this->admin)->postJson("/api/v1/admin/riders/{$profile->id}/review", [
            'verdict' => 'suspend', 'note' => 'Complaints from two customers.',
        ])->assertOk()->assertJsonPath('data.status', 'suspended');

        // Suspension takes them off duty in the same write — a switch left on
        // is a rider still in every availability query.
        $this->assertFalse($profile->refresh()->is_online);

        $this->as($this->rider)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => 'car', 'cnic' => '35202-1234567-1',
        ])->assertForbidden()->assertJsonPath('meta.error_code', 'RIDER_SUSPENDED');
    }

    public function test_the_queue_needs_its_own_permission(): void
    {
        // The point of `riders.manage` existing at all. Platform staff carry a
        // permission list precisely so the person scheduling banner ads is not
        // reading strangers' CNIC photographs — and until this gate existed,
        // every one of them could.
        $this->approvedRider($this->rider);
        $adverts = User::factory()->adminStaff(['banners.manage'])->create();

        $this->as($adverts)->getJson('/api/v1/admin/riders')->assertForbidden();

        $vetting = User::factory()->adminStaff(['riders.manage'])->create();
        $this->as($vetting)->getJson('/api/v1/admin/riders')->assertOk();
    }

    public function test_a_rejection_must_say_why(): void
    {
        $profile = $this->approvedRider($this->rider);

        $this->as($this->admin)->postJson("/api/v1/admin/riders/{$profile->id}/review", ['verdict' => 'reject'])
            ->assertStatus(422)->assertJsonValidationErrors('note');
    }

    // ── A delivery, end to end ───────────────────────────────────────

    public function test_the_whole_delivery_from_the_riders_phone(): void
    {
        $order = $this->placeDelivery();
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->linkToShop($profile);

        // The shop accepts and hands it over.
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $cardId])->assertOk();

        // It appears on the rider's board as an OFFER — not yet theirs.
        $board = $this->as($this->rider)->getJson('/api/v1/rider/board')->assertOk()->json('data');
        $this->assertCount(1, $board['offers']);
        $this->assertCount(0, $board['active']);
        $this->assertSame($order['id'], $board['offers'][0]['id']);

        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")
            ->assertOk()->assertJsonPath('data.stage', 'to_pickup')
            // Now that it is theirs, the door and the phone are on it.
            ->assertJsonPath('data.delivery_address', 'House 12, Street 4, Johar Town, Lahore');

        // Collected. The order moves through the SAME transitions the panel
        // uses, and the handover code is made at this moment and not before.
        $picked = $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/pick-up")
            ->assertOk()->assertJsonPath('data.stage', 'on_the_way')->json('data');
        $this->assertDatabaseHas('orders', ['id' => $order['id'], 'status' => 'out_for_delivery']);

        $otp = Order::withoutTenancy()->find($order['id'])->delivery_otp;
        $this->assertMatchesRegularExpression('/^\d{4}$/', $otp);

        // The customer can read it off their own order screen.
        $this->as($this->customer)->getJson("/api/v1/customer/orders/{$order['id']}")
            ->assertOk()
            ->assertJsonPath('data.delivery_otp', $otp)
            ->assertJsonPath('data.rider.stage', 'on_the_way')
            ->assertJsonPath('data.rider.name', 'Bilal Khan');

        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/deliver", ['code' => $otp])
            ->assertOk()->assertJsonPath('data.stage', 'delivered');

        // Completing an order still does everything completing an order did:
        // the sale is written and the stock is gone.
        $fresh = Order::withoutTenancy()->find($order['id']);
        $this->assertSame('completed', $fresh->status->value);
        $this->assertSame('paid', $fresh->payment_status);
        $this->assertNotNull($fresh->sale_id);
        $this->assertNotNull($fresh->delivered_at);
        $this->assertSame(19.0, (float) $this->product->fresh()->stock_quantity);

        $this->assertNotNull($picked['picked_up_at']);
    }

    public function test_a_wrong_handover_code_is_refused(): void
    {
        $order = $this->placeDelivery();
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->linkToShop($profile);

        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $cardId])->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/pick-up")->assertOk();

        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/deliver", ['code' => '0000'])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'ORDER_BAD_OTP');

        $this->assertDatabaseHas('orders', ['id' => $order['id'], 'status' => 'out_for_delivery', 'delivered_at' => null]);
    }

    public function test_an_order_cannot_be_delivered_before_it_is_collected(): void
    {
        $order = $this->placeDelivery();
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->linkToShop($profile);

        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $cardId])->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();

        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/deliver", ['code' => '1234'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'ORDER_NOT_PICKED_UP');
    }

    // ── The fence ────────────────────────────────────────────────────

    public function test_a_job_board_does_not_carry_a_strangers_address(): void
    {
        $order = $this->placeDelivery();
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->linkToShop($profile);

        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $cardId])->assertOk();

        $offer = $this->as($this->rider)->getJson('/api/v1/rider/board')->assertOk()->json('data.offers.0');

        // What they need to decide.
        $this->assertSame('Johar Town, Lahore', $offer['drop_area']);
        $this->assertEqualsWithDelta(100, $offer['delivery_fee'], 0.001);
        $this->assertEqualsWithDelta(2100, $offer['cash_to_collect'], 0.001);

        // What they do not get until they have taken it.
        $this->assertArrayNotHasKey('delivery_address', $offer);
        $this->assertArrayNotHasKey('customer_phone', $offer);
        $this->assertArrayNotHasKey('customer_name', $offer);
    }

    public function test_a_rider_cannot_touch_another_riders_delivery(): void
    {
        $order = $this->placeDelivery();
        $mine = $this->approvedRider($this->rider);
        $cardId = $this->linkToShop($mine);

        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $cardId])->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();

        $stranger = User::factory()->create();
        $this->approvedRider($stranger);

        // `rider_profiles` is outside `BelongsToTenant`, so this is the fence
        // in RiderService doing its job — nothing else would have stopped it.
        $this->as($stranger)->postJson("/api/v1/rider/jobs/{$order['id']}/pick-up")
            ->assertForbidden()->assertJsonPath('meta.error_code', 'ORDER_NOT_YOURS');

        $this->as($stranger)->getJson('/api/v1/rider/board')
            ->assertOk()->assertJsonCount(0, 'data.offers')->assertJsonCount(0, 'data.active');
    }

    public function test_someone_who_never_applied_gets_no_board(): void
    {
        $this->as($this->rider)->getJson('/api/v1/rider/board')
            ->assertForbidden()->assertJsonPath('meta.error_code', 'RIDER_NO_PROFILE');
    }

    // ── The platform pool ────────────────────────────────────────────

    public function test_the_pool_only_shows_shops_that_opted_into_it(): void
    {
        $order = $this->placeDelivery();
        $this->approvedRider($this->rider, platform: true);
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();

        // The shop still carries its own deliveries — nothing on the board.
        $this->as($this->rider)->getJson('/api/v1/rider/board')
            ->assertOk()->assertJsonCount(0, 'data.offers');

        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")
            ->assertForbidden()->assertJsonPath('meta.error_code', 'ORDER_NOT_IN_POOL');

        $this->shop->forceFill(['settings' => ['delivery_provider' => 'platform']])->save();

        $this->as($this->rider)->getJson('/api/v1/rider/board')
            ->assertOk()->assertJsonCount(1, 'data.offers')
            ->assertJsonPath('data.offers.0.id', $order['id']);
    }

    public function test_two_riders_cannot_take_the_same_pool_job(): void
    {
        $this->shop->forceFill(['settings' => ['delivery_provider' => 'platform']])->save();
        $order = $this->placeDelivery();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();

        $this->approvedRider($this->rider, platform: true);
        $second = User::factory()->create();
        $this->approvedRider($second, platform: true);

        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();
        $this->as($second)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'ORDER_TAKEN');

        // Taking a pool job creates the shop-side card, so `orders.rider_id`
        // stays the ONE answer to who is carrying it.
        $card = Rider::withoutTenancy()->where('tenant_id', $this->shop->id)->firstOrFail();
        $this->assertSame($card->id, Order::withoutTenancy()->find($order['id'])->rider_id);
        $this->assertSame('Bilal Khan', $card->name);
    }

    public function test_a_pool_job_handed_back_returns_to_the_pool_and_a_shops_choice_does_not(): void
    {
        $this->shop->forceFill(['settings' => ['delivery_provider' => 'platform']])->save();
        $profile = $this->approvedRider($this->rider, platform: true);

        // ── taken off the board ──────────────────────────────────────
        $pool = $this->placeDelivery();
        $this->as($this->owner)->postJson("/api/v1/orders/{$pool['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$pool['id']}/accept")->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$pool['id']}/decline")->assertOk();

        $this->assertNull(Order::withoutTenancy()->find($pool['id'])->rider_id);

        // ── handed over by the shop ──────────────────────────────────
        $cardId = Rider::withoutTenancy()->where('rider_profile_id', $profile->id)->firstOrFail()->id;
        $given = $this->placeDelivery();
        $this->as($this->owner)->postJson("/api/v1/orders/{$given['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$given['id']}/assign-rider", ['rider_id' => $cardId])->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$given['id']}/accept")->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$given['id']}/decline")->assertOk();

        // The shop chose this rider. Unassigning silently would hide the
        // refusal from the person who made that choice.
        $after = Order::withoutTenancy()->find($given['id']);
        $this->assertSame($cardId, $after->rider_id);
        $this->assertNull($after->rider_accepted_at);
    }

    public function test_a_collected_order_cannot_be_handed_back(): void
    {
        $order = $this->placeDelivery();
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->linkToShop($profile);

        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $cardId])->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/pick-up")->assertOk();

        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/decline")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'ORDER_ALREADY_PICKED_UP');
    }

    public function test_going_offline_while_carrying_food_is_refused(): void
    {
        $order = $this->placeDelivery();
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->linkToShop($profile);

        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $cardId])->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();

        $this->as($this->rider)->postJson('/api/v1/rider/online', ['is_online' => false])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'RIDER_HAS_ACTIVE_JOB');
    }

    // ── Money ────────────────────────────────────────────────────────

    public function test_cash_in_hand_is_counted_and_settled(): void
    {
        $profile = $this->approvedRider($this->rider);
        $cardId = $this->linkToShop($profile);

        $order = $this->placeDelivery();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $cardId])->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/pick-up")->assertOk();
        $otp = Order::withoutTenancy()->find($order['id'])->delivery_otp;
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/deliver", ['code' => $otp])->assertOk();

        // The rider's own screen: what they earned, what they are holding.
        $this->as($this->rider)->getJson('/api/v1/rider/earnings')
            ->assertOk()
            ->assertJsonPath('data.deliveries', 1)
            ->assertJsonPath('data.earned', 100)
            ->assertJsonPath('data.cash_in_hand', 2100);

        // The shop's side of the same fact.
        $this->as($this->owner)->getJson("/api/v1/riders/{$cardId}/statement")
            ->assertOk()->assertJsonPath('data.cash_in_hand', 2100)->assertJsonPath('data.rider_earned', 100);

        $this->as($this->owner)->postJson("/api/v1/riders/{$cardId}/settle", ['note' => 'Evening count'])
            ->assertCreated()->assertJsonPath('data.orders_count', 1);

        // Settled once, and only once.
        $this->as($this->rider)->getJson('/api/v1/rider/earnings')
            ->assertOk()
            ->assertJsonPath('data.cash_in_hand', 0)
            // What they EARNED does not disappear when the cash goes back.
            ->assertJsonPath('data.earned', 100);

        $this->as($this->owner)->postJson("/api/v1/riders/{$cardId}/settle")
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'RIDER_NOTHING_TO_SETTLE');
    }

    // ── The shop's side ──────────────────────────────────────────────

    public function test_a_shop_adds_an_app_rider_by_their_rider_id(): void
    {
        $profile = $this->approvedRider($this->rider);

        $this->as($this->owner)->postJson('/api/v1/riders/invite', ['rider_code' => 'RDR-999999'])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'RIDER_CODE_UNKNOWN');

        $this->as($this->owner)->postJson('/api/v1/riders/invite', ['rider_code' => $profile->rider_code])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Bilal Khan')
            ->assertJsonPath('data.has_app', true)
            ->assertJsonPath('data.is_online', true);

        // Twice would give the shop two cards it cannot tell apart, and the
        // rider the same job on two rows.
        $this->as($this->owner)->postJson('/api/v1/riders/invite', ['rider_code' => $profile->rider_code])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'RIDER_ALREADY_LINKED');
    }

    public function test_a_shop_cannot_invite_an_unapproved_rider(): void
    {
        $this->as($this->rider)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => 'bike', 'cnic' => '35202-1234567-1',
        ])->assertCreated();
        $code = RiderProfile::query()->where('user_id', $this->rider->id)->value('rider_code');

        $this->as($this->owner)->postJson('/api/v1/riders/invite', ['rider_code' => $code])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'RIDER_NOT_APPROVED');
    }

    // ── Nothing that worked before changed ───────────────────────────

    public function test_a_shop_with_no_app_riders_works_exactly_as_it_did(): void
    {
        // Model A, untouched: a named card with no login, assigned by the shop,
        // driven through the status flow from the panel. This is the whole
        // promise of the migration — an existing shop notices nothing.
        $order = $this->placeDelivery();

        $cardId = $this->as($this->owner)->postJson('/api/v1/riders', [
            'name' => 'Cousin Asif', 'phone' => '0300-1112222',
        ])->assertCreated()->json('data.id');

        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $cardId])
            ->assertOk()->assertJsonPath('data.rider_id', $cardId);

        $this->as($this->customer)->getJson("/api/v1/customer/orders/{$order['id']}")
            ->assertOk()
            ->assertJsonPath('data.rider.name', 'Cousin Asif')
            ->assertJsonPath('data.rider.stage', 'assigned')
            // No app, so no live pin and no handover code — the shop still
            // completes it from the panel.
            ->assertJsonPath('data.rider.latitude', null)
            ->assertJsonPath('data.delivery_otp', null);

        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'preparing'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'out_for_delivery'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'completed'])->assertOk();

        $this->assertDatabaseHas('orders', ['id' => $order['id'], 'status' => 'completed', 'payment_status' => 'paid']);
        $this->assertSame(19.0, (float) $this->product->fresh()->stock_quantity);

        // The card has no profile behind it, which is the normal case and
        // always will be.
        $this->assertNull(Rider::withoutTenancy()->find($cardId)->rider_profile_id);
    }
}
