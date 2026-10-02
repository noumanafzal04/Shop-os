<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Order;
use App\Models\Product;
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
 * A RIDER WHO STILL HAS THE SHOP'S MONEY CANNOT BE REMOVED.
 *
 * Cash on delivery is how most of these shops are paid. The rider carries the
 * goods out, carries the notes back, and until they hand them over the shop's
 * takings are in somebody's pocket. The riders screen is the only place that
 * says how much and whose pocket: `cash_in_hand`, and a Settle button beside
 * it.
 *
 * Remove was a plain soft delete. One press on the wrong row — the commonest
 * reason being a typo in the rider's name, because there is no way to CORRECT
 * one — and the row left the list with the money still on it. The orders keep
 * their rider_id, so nothing is lost in the database; but `index` reads live
 * riders, the statement reads a live rider, and settle posts to a live rider.
 * Every door to that money closes at once, and the figure the shop was
 * watching simply stops being displayed.
 *
 * Nothing warned, and nothing could be undone from the panel.
 *
 * The rule, in the same shape as every other refusal here: the shop is told
 * what is in the way and how much it is.
 */
class TheRiderIsHoldingTheCashTest extends TestCase
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

        $city = City::query()->create([
            'name' => 'Lahore', 'is_active' => true, 'latitude' => 31.52, 'longitude' => 74.35,
        ]);

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
            'name' => 'Rice Bag', 'price' => 2000, 'cost' => 1500,
            'stock_quantity' => 50, 'track_inventory' => true,
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** A card on the shop's riders screen, held by somebody with the app. */
    private function card(): string
    {
        $this->as($this->rider)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => 'bike', 'cnic' => '35202-1234567-1',
        ])->assertCreated();

        foreach (['cnic_front', 'cnic_back', 'selfie', 'licence'] as $type) {
            $this->as($this->rider)->post('/api/v1/rider/documents', [
                'type' => $type, 'file' => UploadedFile::fake()->image("{$type}.jpg"),
            ])->assertOk();
        }

        $this->as($this->rider)->postJson('/api/v1/rider/submit')->assertOk();
        $profile = RiderProfile::query()->where('user_id', $this->rider->id)->firstOrFail();
        $this->as($this->admin)->postJson("/api/v1/admin/riders/{$profile->id}/review", ['verdict' => 'approve'])->assertOk();
        $this->as($this->rider)->postJson('/api/v1/rider/online', [
            'is_online' => true, 'latitude' => 31.52, 'longitude' => 74.35,
        ])->assertOk();

        return $this->as($this->owner)
            ->postJson('/api/v1/riders/invite', ['rider_code' => $profile->fresh()->rider_code])
            ->assertCreated()->json('data.id');
    }

    /** One cash-on-delivery order, out and delivered, money in the rider's pocket. */
    private function deliveredForCash(string $cardId): void
    {
        $order = $this->as($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => 'House 12, Johar Town, Lahore',
            'latitude' => 31.47, 'longitude' => 74.27,
            'payment_method' => 'cod',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $cardId])->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/accept")->assertOk();
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/pick-up")->assertOk();

        $otp = Order::withoutTenancy()->find($order['id'])->delivery_otp;
        $this->as($this->rider)->postJson("/api/v1/rider/jobs/{$order['id']}/deliver", ['code' => $otp])->assertOk();
    }

    private function cashOnTheScreen(string $cardId): ?float
    {
        $rows = $this->as($this->owner)->getJson('/api/v1/riders')->assertOk()->json('data');
        foreach ($rows as $row) {
            if ($row['id'] === $cardId) {
                return (float) $row['cash_in_hand'];
            }
        }

        return null; // the rider is no longer on the screen at all
    }

    public function test_a_rider_holding_the_shops_cash_cannot_be_removed(): void
    {
        $cardId = $this->card();
        $this->deliveredForCash($cardId);

        $held = $this->cashOnTheScreen($cardId);
        $this->assertSame(2100.0, $held, 'the fixture did not actually put cash in the rider\'s hands');

        $this->as($this->owner)->deleteJson("/api/v1/riders/{$cardId}")
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'RIDER_HOLDS_CASH');

        // And the figure is still on the screen, which is the whole point —
        // a refusal that still loses sight of the money is not a refusal.
        $this->assertSame(2100.0, $this->cashOnTheScreen($cardId));
    }

    public function test_the_refusal_says_how_much_is_in_the_rider_s_pocket(): void
    {
        $cardId = $this->card();
        $this->deliveredForCash($cardId);

        $message = $this->as($this->owner)->deleteJson("/api/v1/riders/{$cardId}")
            ->assertStatus(422)->json('message');

        // A shop cannot act on "this rider has unsettled cash". It can act on
        // a number it can count out of a pocket.
        $this->assertStringContainsString('2,100', (string) $message);
    }

    /**
     * THE DENOMINATOR. Without these two the rule above is satisfied by a
     * delete that refuses everybody, which would be a worse bug than the one
     * it replaced.
     */
    public function test_a_rider_holding_nothing_is_removed(): void
    {
        $cardId = $this->card();

        $this->as($this->owner)->deleteJson("/api/v1/riders/{$cardId}")->assertOk();
        $this->assertNull($this->cashOnTheScreen($cardId));
    }

    public function test_once_the_cash_is_settled_the_rider_can_go(): void
    {
        $cardId = $this->card();
        $this->deliveredForCash($cardId);

        $this->as($this->owner)->postJson("/api/v1/riders/{$cardId}/settle")->assertCreated();
        $this->assertSame(0.0, $this->cashOnTheScreen($cardId));

        $this->as($this->owner)->deleteJson("/api/v1/riders/{$cardId}")->assertOk();
        $this->assertNull($this->cashOnTheScreen($cardId));
    }

    /**
     * AND THE REASON THE WRONG ROW GETS PRESSED IN THE FIRST PLACE.
     *
     * The riders screen offers Settle cash, Deactivate and Remove. It does not
     * offer a way to change a name or a phone number — yet `PATCH /riders/{id}`
     * has accepted both since the module was written. A shop that typed
     * "Blial" or an old number had exactly one way to correct it: remove the
     * rider and add them again. That is how a row with cash on it gets
     * deleted.
     *
     * The endpoint is asserted here so the panel control added beside it has
     * something that fails when the door closes again.
     */
    public function test_a_rider_s_name_and_number_can_be_corrected(): void
    {
        $cardId = $this->card();

        $this->as($this->owner)->patchJson("/api/v1/riders/{$cardId}", [
            'name' => 'Bilal Khan', 'phone' => '0300-7654321',
        ])->assertOk();

        $this->assertDatabaseHas('riders', [
            'id' => $cardId, 'name' => 'Bilal Khan', 'phone' => '0300-7654321',
        ]);
    }
}
