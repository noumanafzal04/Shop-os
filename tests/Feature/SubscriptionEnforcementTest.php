<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class SubscriptionEnforcementTest extends TestCase
{
    use RefreshDatabase;

    private Plan $plan;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(PlanSeeder::class);
        $this->plan = Plan::query()->where('code', 'business-pos')->first(); // 7-day grace
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function tenantWith(?string $endsAt): array
    {
        $tenant = Tenant::factory()->provisioned()->create([
            'plan_id' => $this->plan->id,
            'subscription_starts_at' => now()->subMonth(),
            'subscription_ends_at' => $endsAt,
        ]);
        $owner = User::factory()->shopOwner($tenant)->create();
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Widget', 'price' => 100, 'stock_quantity' => 10,
        ]);

        return [$tenant, $owner, $product];
    }

    public function test_active_subscription_allows_writes(): void
    {
        [, $owner, $product] = $this->tenantWith(now()->addMonth()->toDateTimeString());

        $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 100,
        ])->assertCreated();
    }

    public function test_grace_period_still_allows_writes_with_state_flag(): void
    {
        // Expired 2 days ago, 7-day grace → state 'grace', writes work.
        [, $owner, $product] = $this->tenantWith(now()->subDays(2)->toDateTimeString());

        $this->actingAsUser($owner)->getJson('/api/v1/dashboard')
            ->assertOk()
            ->assertJsonPath('data.subscription_state', 'grace');

        $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 100,
        ])->assertCreated();
    }

    public function test_read_only_after_grace_blocks_writes_but_allows_reads(): void
    {
        // Expired 10 days ago, 7-day grace → read_only.
        [, $owner, $product] = $this->tenantWith(now()->subDays(10)->toDateTimeString());

        // Login still works (never a hard lockout).
        // Reads work — the owner can see everything.
        $this->actingAsUser($owner)->getJson('/api/v1/dashboard')
            ->assertOk()
            ->assertJsonPath('data.subscription_state', 'read_only');
        $this->actingAsUser($owner)->getJson('/api/v1/products')->assertOk();
        $this->actingAsUser($owner)->getJson('/api/v1/sales')->assertOk();

        // Writes are blocked with a clear, safe message.
        $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 100,
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'SUBSCRIPTION_EXPIRED');

        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'type' => 'product', 'name' => 'New', 'price' => 10,
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'SUBSCRIPTION_EXPIRED');

        $this->actingAsUser($owner)->deleteJson("/api/v1/products/{$product->id}")
            ->assertStatus(403);
    }

    public function test_renewal_by_admin_instantly_lifts_read_only(): void
    {
        [$tenant, $owner, $product] = $this->tenantWith(now()->subDays(30)->toDateTimeString());
        $admin = User::factory()->superAdmin()->create();

        // Blocked before renewal…
        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'type' => 'product', 'name' => 'Blocked', 'price' => 10,
        ])->assertStatus(403);

        // Admin renews (assign-plan resets the window).
        $this->actingAsUser($admin)->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", [
            'plan_id' => $this->plan->id,
        ])->assertOk();

        // …and everything works again, data intact.
        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'type' => 'product', 'name' => 'Unblocked', 'price' => 10,
        ])->assertCreated();
        $this->actingAsUser($owner)->getJson('/api/v1/products')
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 2); // Widget + Unblocked ("Blocked" never saved)
    }

    public function test_tenant_without_subscription_window_is_unrestricted(): void
    {
        [, $owner, $product] = $this->tenantWith(null);

        $this->actingAsUser($owner)->getJson('/api/v1/dashboard')
            ->assertOk()
            ->assertJsonPath('data.subscription_state', 'active');

        $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 100,
        ])->assertCreated();
    }
}
