<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Boundary edge cases for the flexible plan-limits engine: the EXACT Nth
 * create must land while N+1 is refused, per-tenant extensions add their own
 * hard boundary and clearing them re-arms the plan baseline, CSV imports fail
 * only the rows past the ceiling, usage is counted LIVE (deletes free slots),
 * and the merchant subscription page mirrors the effective numbers.
 */
class PlansLimitsEdgeCasesTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->admin = User::factory()->superAdmin()->create();
    }

    private function login(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /**
     * A shop with these ceilings. The keys split by owner, exactly as the
     * platform does: max_products / max_storage_mb / max_orders_month are what
     * the PLAN sells, while staff, branches and lanes are ASSIGNED to this shop
     * — so a two-branch business no longer needs a plan of its own.
     */
    private function planWith(array $limits): Plan
    {
        return Plan::query()->create([
            'name' => 'Edge Plan',
            'code' => 'edge-plan',
            'price' => 0,
            'billing_period_months' => 1,
            'grace_period_days' => 7,
            ...collect($limits)->only(['max_products', 'max_storage_mb', 'max_orders_month'])->all(),
        ]);
    }

    /** The tenant-side half of the same array: max_staff → limits.staff, etc. */
    private function assignedFrom(array $limits): array
    {
        $map = ['max_staff' => 'staff', 'max_branches' => 'branches', 'max_registers' => 'registers'];

        return collect($limits)->only(array_keys($map))
            ->mapWithKeys(fn ($v, $k) => [$map[$k] => $v])->all();
    }

    /** @return array{0: Tenant, 1: User} */
    private function shopOn(?Plan $plan, array $overrides = []): array
    {
        $tenant = Tenant::factory()->provisioned()->create(array_merge([
            'plan_id' => $plan?->id,
            'limits' => null,
        ], $overrides));
        $owner = User::factory()->shopOwner($tenant)->create();

        return [$tenant, $owner];
    }

    private function createProduct(User $owner, string $name): TestResponse
    {
        return $this->login($owner)->postJson('/api/v1/products', [
            'type' => 'product', 'name' => $name, 'price' => 10,
        ]);
    }

    private function createStaff(User $owner, string $name): TestResponse
    {
        return $this->login($owner)->postJson('/api/v1/staff', [
            'name' => $name,
            'email' => strtolower($name).'@shop.test',
            'password' => 'password123',
            'permissions' => [Permissions::tenant()[0]],
        ]);
    }

    // ── (1) exact product boundary ───────────────────────────────────────

    public function test_nth_product_lands_and_n_plus_one_is_refused(): void
    {
        [, $owner] = $this->shopOn($this->planWith(['max_products' => 3]), ['limits' => $this->assignedFrom(['max_products' => 3])]);

        $this->createProduct($owner, 'One')->assertCreated();
        $this->createProduct($owner, 'Two')->assertCreated();
        // The Nth item is INSIDE the plan — usage == limit is allowed.
        $this->createProduct($owner, 'Three')->assertCreated();

        // N+1 is the first refusal, with the machine-readable code the
        // frontend keys its upgrade prompt on.
        $this->createProduct($owner, 'Four')
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'LIMIT_REACHED');
    }

    // ── (2) override lifecycle: extend, its own boundary, then fall back ──

    public function test_override_extends_past_the_plan_and_clearing_rearms_the_baseline(): void
    {
        [$tenant, $owner] = $this->shopOn($this->planWith(['max_products' => 2]), ['limits' => $this->assignedFrom(['max_products' => 2])]);

        $this->createProduct($owner, 'One')->assertCreated();
        $this->createProduct($owner, 'Two')->assertCreated();
        $this->createProduct($owner, 'Three')
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'LIMIT_REACHED');

        // Admin extends THIS tenant to 4 — creation resumes past the plan.
        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'limits' => ['products' => 4],
        ])->assertOk()->assertJsonPath('data.limits.products', 4);

        $this->createProduct($owner, 'Three')->assertCreated();
        $this->createProduct($owner, 'Four')->assertCreated();

        // The override is a hard ceiling of its own, not "unlimited".
        $this->createProduct($owner, 'Five')
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'LIMIT_REACHED');

        // Clearing (null) drops the override entirely...
        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'limits' => ['products' => null],
        ])->assertOk()->assertJsonPath('data.limits', []);

        // ...so the plan baseline (2) governs again: with 4 already on the
        // books the shop is over-quota and stays blocked.
        $this->createProduct($owner, 'Five')
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'LIMIT_REACHED');
    }

    // ── (3) staff boundary: owner excluded, exact edge, extendable ───────

    public function test_staff_boundary_excludes_the_owner_and_extends_like_products(): void
    {
        [$tenant, $owner] = $this->shopOn($this->planWith(['max_staff' => 2]), ['limits' => $this->assignedFrom(['max_staff' => 2])]);

        // Two seats, two staff — the OWNER never occupies a staff seat.
        $this->createStaff($owner, 'Aisha')->assertCreated();
        $this->createStaff($owner, 'Bilal')->assertCreated();
        $this->createStaff($owner, 'Chand')
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'LIMIT_REACHED');

        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'limits' => ['staff' => 3],
        ])->assertOk();

        $this->createStaff($owner, 'Chand')->assertCreated();
        // The extension's own edge holds too.
        $this->createStaff($owner, 'Danish')
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'LIMIT_REACHED');
    }

    // ── (4) CSV import at a nearly-full limit ────────────────────────────

    public function test_csv_import_fails_only_the_rows_beyond_the_limit(): void
    {
        [$tenant, $owner] = $this->shopOn($this->planWith(['max_products' => 3]), ['limits' => $this->assignedFrom(['max_products' => 3])]);
        Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Keeper', 'sku' => 'KEEP-1', 'price' => 100, 'stock_quantity' => 5,
        ]);

        // 1 slot used, 2 free. Sugar+Salt fit; Flour is over the ceiling; the
        // KEEP-1 row UPDATES an existing product (no new slot needed) and
        // proves the batch kept going after the failed row.
        $csv = "name,sku,price\n"
            ."Sugar,SUG-1,100\n"
            ."Salt,SAL-1,50\n"
            ."Flour,FLR-1,80\n"
            .'Keeper,KEEP-1,150';

        $res = $this->login($owner)->postJson('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent('products.csv', $csv),
        ])->assertOk()->json('data');

        $this->assertSame(4, $res['total']);
        $this->assertSame(2, $res['created']);
        $this->assertSame(1, $res['updated']);
        $this->assertSame(1, $res['failed']);

        // Only the over-limit row errored — line 4 of the file (Flour).
        $this->assertCount(1, $res['errors']);
        $this->assertSame(4, $res['errors'][0]['row']);
        $this->assertStringContainsString('reached your limit', $res['errors'][0]['messages'][0]);

        // The catalog sits exactly AT the ceiling and the update row really
        // landed (price moved to 150).
        $this->assertSame(3, Product::withoutTenancy()->where('tenant_id', $tenant->id)->count());
        $this->assertSame(
            '150.00',
            (string) Product::withoutTenancy()->where('sku', 'KEEP-1')->first()->price,
        );
    }

    // ── (5) no plan = unlimited on what a plan sells ─────────────────────

    public function test_a_tenant_without_a_plan_is_unlimited_on_what_a_plan_sells(): void
    {
        // A plan meters usage: products, storage, orders a month. With no plan
        // there is nothing metering them, so they are uncapped.
        //
        // Branches, staff and lanes are a different thing — they are assigned
        // to the shop, and an unassigned one falls to the platform default
        // rather than to "as many as you like". A shop nobody sized should look
        // like a small shop, not an unlimited one.
        [, $owner] = $this->shopOn(null);

        foreach (['A', 'B', 'C', 'D'] as $name) {
            $this->createProduct($owner, "Item {$name}")->assertCreated();
        }
        $this->createStaff($owner, 'Aisha')->assertCreated();
        $this->createStaff($owner, 'Bilal')->assertCreated();

        $data = $this->login($owner)->getJson('/api/v1/shop/subscription')
            ->assertOk()->json('data');

        $this->assertNull($data['plan']);

        $usage = collect($data['limits_usage']);
        $billed = $usage->where('owner', 'plan');
        $assigned = $usage->where('owner', 'tenant');

        $this->assertTrue($billed->every(fn ($u) => $u['unlimited'] === true && $u['limit'] === null));
        $this->assertTrue($assigned->every(fn ($u) => $u['unlimited'] === false && $u['limit'] !== null));
        $this->assertSame(5, $usage->firstWhere('key', 'staff')['limit']);
    }

    // ── (6) subscription page: effective limit + live usage ──────────────

    public function test_subscription_page_shows_the_overridden_limit_and_live_usage(): void
    {
        $plan = $this->planWith(['max_products' => 5]);
        [, $owner] = $this->shopOn($plan, [
            // Products extended past the plan's 5; staff assigned outright.
            'limits' => ['products' => 8, 'staff' => 2],
            'subscription_starts_at' => now()->subDays(5),
            'subscription_ends_at' => now()->addDays(25),
        ]);

        $this->createProduct($owner, 'One')->assertCreated();
        $this->createProduct($owner, 'Two')->assertCreated();
        $this->createStaff($owner, 'Aisha')->assertCreated();

        $usage = collect(
            $this->login($owner)->getJson('/api/v1/shop/subscription')
                ->assertOk()->json('data.limits_usage'),
        );

        // Products meter shows the EXTENDED ceiling (8), not the plan's 5.
        $products = $usage->firstWhere('key', 'products');
        $this->assertSame(8, $products['limit']);
        $this->assertSame(2, $products['used']);
        $this->assertSame(6, $products['remaining']);
        $this->assertFalse($products['unlimited']);

        // Staff was assigned to this shop; no plan has an opinion on it.
        $staff = $usage->firstWhere('key', 'staff');
        $this->assertSame(2, $staff['limit']);
        $this->assertSame(1, $staff['used']);

        // Usage is a LIVE count: one more product moves the meter on the
        // very next read, no cached counter in between.
        $this->createProduct($owner, 'Three')->assertCreated();
        $products = collect(
            $this->login($owner)->getJson('/api/v1/shop/subscription')->json('data.limits_usage'),
        )->firstWhere('key', 'products');
        $this->assertSame(3, $products['used']);
        $this->assertSame(5, $products['remaining']);
    }

    // ── live counting: deleting frees the slot immediately ───────────────

    public function test_deleting_a_product_frees_its_slot_immediately(): void
    {
        [, $owner] = $this->shopOn($this->planWith(['max_products' => 1]), ['limits' => $this->assignedFrom(['max_products' => 1])]);

        $solo = $this->createProduct($owner, 'Solo')->assertCreated()->json('data');
        $this->createProduct($owner, 'Extra')
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'LIMIT_REACHED');

        $this->login($owner)->deleteJson("/api/v1/products/{$solo['id']}")->assertOk();

        // Live counting: no stale counter holds the slot hostage.
        $this->createProduct($owner, 'Extra')->assertCreated();
    }
}
