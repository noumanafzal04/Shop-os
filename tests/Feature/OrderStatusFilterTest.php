<?php

namespace Tests\Feature;

use App\Enums\OrderStatus;
use App\Enums\UserRole;
use App\Models\Branch;
use App\Models\City;
use App\Models\Order;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE ORDERS LIST COULD NOT BE FILTERED BY STATUS. AT ALL.
 *
 * `OrderController::index` built its scoped query like this:
 *
 *     ->when($except !== 'status' && $request->query('status'),
 *            fn ($q, $s) => $q->where('status', $s))
 *
 * `when()` hands its CONDITION to the callback as the second argument, and
 * PHP's `&&` returns a BOOLEAN — not the right-hand operand. So `$s` was
 * `true`, the query became `where('status', true)`, the database compared a
 * varchar column against 1, and the answer was nothing. Every time, for every
 * status, for every shop.
 *
 * The screen it breaks is the one a shop lives in all day: the Orders list,
 * whose tabs are statuses. Press "Pending" and the list empties while pending
 * orders sit in the table — found with 79 of them in the database.
 *
 * None of the filters beside it has the bug; they pass the value straight.
 * This one grew a second clause (`$except`, for the per-status counts) and the
 * clause quietly changed what `when()` was handing over.
 */
class OrderStatusFilterTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Okara', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $branch = Branch::withoutTenancy()
            ->where('tenant_id', $this->shop->id)->where('is_default', true)->firstOrFail();
        // `orders.customer_id` points at USERS — the person who has an
        // account on the marketplace — not at the shop's own customer book.
        $customer = User::factory()->create(['role' => UserRole::Customer, 'tenant_id' => null]);

        foreach ([OrderStatus::Pending, OrderStatus::Pending, OrderStatus::Confirmed, OrderStatus::Completed] as $i => $status) {
            Order::withoutTenancy()->create([
                'tenant_id' => $this->shop->id,
                'branch_id' => $branch->id,
                'customer_id' => $customer->id,
                'order_number' => 'ORD-'.str_pad((string) ($i + 1), 5, '0', STR_PAD_LEFT),
                'status' => $status->value,
                'channel' => 'marketplace',
                'fulfillment_type' => 'delivery',
                'subtotal' => 100, 'total' => 100,
                'payment_method' => 'cod',
                'payment_status' => 'unpaid',
                'customer_name' => 'Walk-in',
                'placed_at' => now(),
            ]);
        }
    }

    public function test_the_list_is_filtered_by_status(): void
    {
        $rows = $this->actingAsOwner()
            ->getJson('/api/v1/orders?status=pending')
            ->assertOk()
            ->json('data');

        $this->assertCount(2, $rows, 'two orders are pending and the filter found none');
        foreach ($rows as $row) {
            $this->assertSame('pending', $row['status']);
        }
    }

    public function test_another_status_returns_only_its_own(): void
    {
        $rows = $this->actingAsOwner()
            ->getJson('/api/v1/orders?status=confirmed')
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame('confirmed', $rows[0]['status']);
    }

    public function test_a_status_nothing_is_in_returns_nothing(): void
    {
        // The other direction. Without this, a filter that was simply IGNORED
        // would pass the two cases above by returning everything.
        $this->actingAsOwner()
            ->getJson('/api/v1/orders?status=cancelled')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_no_filter_still_returns_the_whole_list(): void
    {
        $this->actingAsOwner()
            ->getJson('/api/v1/orders')
            ->assertOk()
            ->assertJsonCount(4, 'data');
    }

    private function actingAsOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
