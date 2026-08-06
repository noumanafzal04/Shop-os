<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\Product;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The merchant-facing subscription page: own plan, usage vs effective limits,
 * payment history. Read-only.
 */
class SubscriptionPageTest extends TestCase
{
    use RefreshDatabase;

    private function actingAsUser(User $user): static
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_owner_sees_plan_usage_and_payments(): void
    {
        $plan = Plan::query()->create([
            'name' => 'Common', 'code' => 'common', 'price' => 1500,
            'billing_period_months' => 1, 'grace_period_days' => 7,
            'max_products' => 100,
        ]);
        $tenant = Tenant::factory()->provisioned()->create([
            'plan_id' => $plan->id,
            // Staff is assigned to the shop, never sold on the plan.
            'limits' => ['staff' => 10],
            'subscription_starts_at' => now()->subDays(10),
            'subscription_ends_at' => now()->addDays(20),
        ]);
        $owner = User::factory()->shopOwner($tenant)->create();
        Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product', 'name' => 'Widget', 'price' => 10,
        ]);
        SubscriptionPayment::query()->create([
            'tenant_id' => $tenant->id, 'plan_id' => $plan->id, 'plan_name' => 'Common',
            'amount' => 1500, 'method' => 'cash',
            'period_start' => now()->subDays(10)->toDateString(),
            'period_end' => now()->addDays(20)->toDateString(),
            'paid_at' => now()->subDays(10),
        ]);

        $data = $this->actingAsUser($owner)->getJson('/api/v1/shop/subscription')
            ->assertOk()->json('data');

        $this->assertSame('Common', $data['plan']['name']);
        $this->assertSame('active', $data['state']);
        $this->assertCount(1, $data['payments']);

        $usage = collect($data['limits_usage']);
        $products = $usage->firstWhere('key', 'products');
        $this->assertSame(100, $products['limit']);
        $this->assertSame(1, $products['used']);
        // Staff is assigned to the shop; the plan has no say in it.
        $this->assertSame(10, $usage->firstWhere('key', 'staff')['limit']);
    }

    public function test_tenant_without_a_plan_sees_unlimited_on_billed_usage(): void
    {
        $tenant = Tenant::factory()->provisioned()->create(['plan_id' => null]);
        $owner = User::factory()->shopOwner($tenant)->create();

        $data = $this->actingAsUser($owner)->getJson('/api/v1/shop/subscription')
            ->assertOk()->json('data');

        $this->assertNull($data['plan']);
        $this->assertSame('active', $data['state']);

        // Only what a PLAN sells goes uncapped. Branches, staff and lanes are
        // assigned to the shop and fall back to the platform default.
        $usage = collect($data['limits_usage']);
        $this->assertTrue($usage->where('owner', 'plan')->every(fn ($u) => $u['unlimited']));
        $this->assertTrue($usage->where('owner', 'tenant')->every(fn ($u) => ! $u['unlimited']));
    }
}
