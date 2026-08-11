<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * What the shop paid is not what the shop charges.
 *
 * The margin report has always been shut to a cashier. The buying price then
 * walked out anyway on the product grid the till loads on every shift: reads
 * of a product are gated on READS_CATALOG — which includes `sales.manage`,
 * `kitchen.manage` and `orders.manage` — and the model was serialised whole.
 * A cashier, a waiter and the kitchen could all read the cost of every line in
 * the catalog. It is the one number a competitor or a departing member of
 * staff would most like to have.
 *
 * These tests ask it from the counter, which is where it leaked, and they ask
 * it of a variant too — a variant carries its own cost and rides inside the
 * product, so guarding only Product would leave the same figure one level down.
 */
class CostPriceVisibilityTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create();

        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'name' => 'Widget',
            'sku' => 'W-1', 'price' => 100, 'cost' => 60, 'wholesale_price' => 80,
            'track_inventory' => true, 'stock_quantity' => 100,
        ]);

        ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $this->product->id,
            'name' => 'Large', 'sku' => 'W-1-L', 'price' => 120, 'cost' => 70,
            'stock_quantity' => 10, 'is_active' => true,
        ]);
    }

    private function login(User $user): static
    {
        $this->defaultHeaders = [];
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** Somebody rostered on the counter and nothing more. */
    private function cashier(): User
    {
        return User::factory()->tenantStaff($this->tenant, [
            Permissions::SALES_MANAGE,
            Permissions::CUSTOMERS_MANAGE,
        ])->create();
    }

    // ── The leak itself ─────────────────────────────────────────────

    public function test_a_cashier_cannot_read_what_the_shop_paid(): void
    {
        $response = $this->login($this->cashier())->getJson('/api/v1/products');

        $response->assertOk();
        $row = $response->json('data.0');

        $this->assertArrayNotHasKey('cost', $row, 'the buying price reached the till');
        // The selling price must still be there, or the guard has taken the
        // catalog down with it rather than protecting one column.
        $this->assertArrayHasKey('price', $row);
        $this->assertEquals('100.00', $row['price']);
    }

    public function test_a_cashier_cannot_read_it_from_a_single_product_either(): void
    {
        $response = $this->login($this->cashier())
            ->getJson("/api/v1/products/{$this->product->id}");

        $response->assertOk();
        $this->assertArrayNotHasKey('cost', $response->json('data'));
    }

    public function test_a_variant_does_not_carry_the_cost_down_a_level(): void
    {
        // The reason this test exists: a variant has its OWN cost column and is
        // serialised inside the product it belongs to. Guarding the parent and
        // not the child moves the leak rather than closing it.
        $response = $this->login($this->cashier())
            ->getJson("/api/v1/products/{$this->product->id}");

        $response->assertOk();
        $variant = $response->json('data.variants.0');

        $this->assertNotNull($variant, 'the variant did not come back at all');
        $this->assertArrayNotHasKey('cost', $variant);
        $this->assertArrayHasKey('price', $variant);
    }

    public function test_the_kitchen_cannot_read_it(): void
    {
        // kitchen.manage is in READS_CATALOG — the board reads a dish to know
        // what it is making. It has no reason to know what the dish cost.
        $kitchen = User::factory()->tenantStaff($this->tenant, [
            Permissions::KITCHEN_MANAGE,
        ])->create();

        $response = $this->login($kitchen)->getJson('/api/v1/products');

        $response->assertOk();
        $this->assertArrayNotHasKey('cost', $response->json('data.0'));
    }

    // ── The people who need it ──────────────────────────────────────

    public function test_the_owner_still_sees_the_cost(): void
    {
        $owner = User::factory()->shopOwner($this->tenant)->create();

        $response = $this->login($owner)->getJson('/api/v1/products');

        $response->assertOk();
        $this->assertEquals('60.00', $response->json('data.0.cost'));
    }

    #[DataProvider('entitledPermissions')]
    public function test_whoever_cannot_do_their_job_without_a_cost_still_sees_it(string $permission): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, [$permission])->create();

        $response = $this->login($staff)->getJson('/api/v1/products');

        $response->assertOk();
        $this->assertEquals(
            '60.00',
            $response->json('data.0.cost'),
            "{$permission} needs the buying price and was refused it",
        );
    }

    /**
     * The three catalog readers who cannot do their job without a cost.
     *
     * `reports.view` is the fourth member of READS_COST and is deliberately
     * absent here: it is not in READS_CATALOG, so it cannot reach /products at
     * all (it 403s). It earns its place in READS_COST for the report payloads
     * that carry a cost, not for the catalog grid.
     */
    public static function entitledPermissions(): array
    {
        return [
            'the buyer' => [Permissions::PURCHASES_MANAGE],
            'the stock keeper' => [Permissions::INVENTORY_MANAGE],
            'whoever prices the catalog' => [Permissions::PRODUCTS_MANAGE],
        ];
    }

    // ── What the guard must NOT take with it ────────────────────────

    public function test_the_wholesale_price_still_reaches_the_till(): void
    {
        // wholesale_price is a SELLING price. The POS reads it to offer the
        // wholesale level (`levelBase` in PosPage), so stripping it from a
        // cashier protects nothing and silently removes wholesale selling.
        $response = $this->login($this->cashier())->getJson('/api/v1/products');

        $response->assertOk();
        $this->assertEquals('80.00', $response->json('data.0.wholesale_price'));
    }

    public function test_internal_callers_still_cost_a_sale(): void
    {
        // The guard is on serialisation, not on attribute access. If it ever
        // moves to `$hidden` or a select, COGS silently becomes zero and every
        // profit figure in the product is wrong with no error anywhere.
        $this->assertEquals(60, (float) $this->product->fresh()->cost);
    }
}
