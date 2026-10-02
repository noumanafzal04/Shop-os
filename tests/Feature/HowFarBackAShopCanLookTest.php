<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Plan;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * HOW FAR BACK A SHOP CAN LOOK — stated, because it was not.
 *
 * Plans sell a retention window: two years of history on the cheap one, five
 * on the next. Nothing in the schema knew that. The word "retention"
 * appeared nowhere in `app/` except on a rider application, so the promise
 * lived entirely in whatever a salesperson said on the phone — and a shop
 * had no way to read what it had been sold.
 *
 * What this does NOT do is fence any read, and that is deliberate. Hiding a
 * shop's own history is irreversible from where the shopkeeper sits even
 * when the rows are still there: a shop that opens Sales and cannot find
 * last March does not think "my plan covers two years", it thinks its
 * records are lost. Enforcement is a product decision with a support cost,
 * recorded as the open half rather than guessed at.
 */
class HowFarBackAShopCanLookTest extends TestCase
{
    use RefreshDatabase;

    private function shopOn(?int $retentionMonths): array
    {
        $city = City::query()->firstOrCreate(['name' => 'Lahore'], ['is_active' => true]);

        $plan = Plan::query()->create([
            'name' => 'Standard', 'code' => 'std-'.uniqid(), 'price' => 4999,
            'billing_period_months' => 1, 'is_active' => true,
            'retention_months' => $retentionMonths,
        ]);

        $shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'), 'timezone' => 'UTC',
            'plan_id' => $plan->id,
        ]);

        return [$shop, User::factory()->shopOwner($shop)->create()];
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withToken($token);
    }

    public function test_a_shop_can_read_the_window_it_was_sold(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [, $owner] = $this->shopOn(24);

        $this->as($owner)->getJson('/api/v1/shop/subscription')
            ->assertOk()
            ->assertJsonPath('data.plan.retention_months', 24);
    }

    /**
     * NULL IS NO LIMIT, AND IT IS THE DEFAULT.
     *
     * Every plan that existed before this column did keeps everything. A
     * column appearing must never narrow a shop's window.
     */
    public function test_a_plan_with_no_window_set_keeps_everything(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [, $owner] = $this->shopOn(null);

        $this->as($owner)->getJson('/api/v1/shop/subscription')
            ->assertOk()
            ->assertJsonPath('data.plan.retention_months', null);
    }

    public function test_the_platform_can_set_a_window_on_a_plan(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $admin = User::factory()->superAdmin()->create();

        $plan = $this->as($admin)->postJson('/api/v1/admin/plans', [
            'name' => 'Basic', 'code' => 'basic-'.uniqid(), 'price' => 2499,
            'billing_period_months' => 1, 'grace_period_days' => 7, 'retention_months' => 24,
        ])->assertCreated()->json('data');

        $this->assertSame(24, $plan['limits']['retention_months']);
    }

    /**
     * NOTHING IS HIDDEN YET, AND THAT IS THE POINT.
     *
     * A sale from four years ago is still readable on a two-year plan. The
     * policy is recorded and visible; fencing the read is a separate
     * decision, and shipping it quietly alongside the column would be the
     * worst way to make it.
     */
    public function test_recording_the_window_hides_nothing(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [$shop, $owner] = $this->shopOn(24);

        $old = Sale::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'invoice_number' => 'INV-OLD-1',
            'channel' => 'walk_in',
            'status' => 'completed',
            'subtotal' => 100, 'discount' => 0, 'tax' => 0, 'total' => 100,
            'amount_paid' => 100, 'change_due' => 0,
            'payment_method' => 'cash',
            'sold_at' => now()->subYears(4),
            'created_at' => now()->subYears(4),
            'updated_at' => now()->subYears(4),
        ]);

        $found = collect(
            $this->as($owner)->getJson('/api/v1/sales?per_page=100')->assertOk()->json('data'),
        )->pluck('id');

        $this->assertTrue($found->contains($old->id), 'A four-year-old sale was hidden by a policy nobody enforced.');
    }
}
