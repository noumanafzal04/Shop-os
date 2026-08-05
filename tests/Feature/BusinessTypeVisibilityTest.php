<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Module gating / business-type visibility.
 *
 * Proves that a tenant only reaches the endpoints its MODULE FLAGS allow. The
 * gate is always the flag (tenants.features), seeded per business type by
 * BusinessTypes::defaultFeatures() and adjustable per tenant by an admin — so
 * these tests assert BOTH directions:
 *
 *   - a type whose default map has the module OFF gets 403 MODULE_DISABLED
 *     (App\Http\Middleware\EnsureFeature), even as the shop OWNER, who holds
 *     every permission — i.e. the module gate is independent of the
 *     permission gate and cannot be out-ranked by role;
 *   - a type whose default map has it ON gets through (2xx).
 *
 * The last group flips a flag by hand on a type that normally has it on, which
 * is the proof that the gate reads the FLAG and not the business_type string.
 *
 * Matrix under test (BusinessTypes::defaultFeatures):
 *   type       products services inventory marketplace reservations delivery dine_in
 *   food          T        F         F          T            F          T       T
 *   mart          T        F         T          T            F          T       -
 *   pharmacy      T        F         T          F            F          T       -
 *   retail        T        F         T          T            T          T       -
 *   services      F        T         F          F            F          F       -
 *   petroleum     T        T         T          F            F          F       -
 */
class BusinessTypeVisibilityTest extends TestCase
{
    use RefreshDatabase;

    /** One GET endpoint per gated module — the cheapest probe for each gate. */
    private const PROBE = [
        'suppliers' => '/api/v1/suppliers',              // feature:inventory
        'purchase_orders' => '/api/v1/purchase-orders',        // feature:inventory
        'inventory' => '/api/v1/inventory/low-stock',      // feature:inventory
        'warranty' => '/api/v1/warranty/lookup?serial=X',  // feature:inventory
        'collections' => '/api/v1/collections',             // feature:marketplace
        'orders' => '/api/v1/orders',                  // feature:marketplace
        'riders' => '/api/v1/riders',                  // feature:delivery
        'reviews' => '/api/v1/reviews',                 // feature:marketplace
        'reservations' => '/api/v1/reservations',            // feature:reservations
        'dine_in' => '/api/v1/restaurant/tables',       // feature:dine_in
        'expenses' => '/api/v1/expenses',                // feature:expenses
        'expense_categories' => '/api/v1/expense-categories',      // feature:expenses
        'cashbook' => '/api/v1/cashbook',                // feature:expenses
        'gallery' => '/api/v1/shop/gallery',            // feature:services
        'pos_lookup' => '/api/v1/pos/lookup?code=NOPE',    // feature:pos
    ];

    private City $city;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
    }

    /**
     * A finished shop of the given business type, with its type's default module
     * map (optionally overridden), plus its owner. The owner holds every tenant
     * permission — so anything that 403s below is the MODULE gate, not a role.
     *
     * @param  array<string,bool>  $featureOverrides
     * @return array{0: Tenant, 1: User}
     */
    private function makeShop(string $type, array $featureOverrides = []): array
    {
        $shop = Tenant::factory()->create([
            'business_type' => $type,
            'features' => array_merge(BusinessTypes::defaultFeatures($type), $featureOverrides),
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'city_id' => $this->city->id,
            'timezone' => 'Asia/Karachi',
        ]);

        return [$shop, User::factory()->shopOwner($shop)->create()];
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** The module gate fired: 403 + MODULE_DISABLED (not a permission denial). */
    private function assertBlocked(User $owner, string $probe): void
    {
        $this->actingAsUser($owner)->getJson(self::PROBE[$probe])
            ->assertStatus(403)
            ->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
    }

    /** The module gate let the request through (2xx — the screen is reachable). */
    private function assertReachable(User $owner, string $probe): void
    {
        $this->actingAsUser($owner)->getJson(self::PROBE[$probe])->assertSuccessful();
    }

    // ── 1. FOOD: dine-in yes, stock chain no ────────────────────────

    public function test_food_tenant_can_reach_dine_in_but_not_inventory_endpoints(): void
    {
        [$shop, $owner] = $this->makeShop('food');
        $this->assertTrue($shop->featureEnabled('dine_in'));
        $this->assertFalse($shop->featureEnabled('inventory'));

        // A restaurant runs a floor.
        $this->assertReachable($owner, 'dine_in');

        // …but menu items aren't stock-tracked, so the whole stock chain is off.
        $this->assertBlocked($owner, 'suppliers');
        $this->assertBlocked($owner, 'purchase_orders');
        $this->assertBlocked($owner, 'inventory');
        $this->assertBlocked($owner, 'warranty');
    }

    // ── 2. SERVICES: neither stock nor storefront ───────────────────

    public function test_services_tenant_cannot_reach_inventory_or_marketplace_endpoints(): void
    {
        [$shop, $owner] = $this->makeShop('services');
        $this->assertFalse($shop->featureEnabled('inventory'));
        $this->assertFalse($shop->featureEnabled('marketplace'));

        $this->assertBlocked($owner, 'suppliers');
        $this->assertBlocked($owner, 'purchase_orders');
        $this->assertBlocked($owner, 'inventory');
        $this->assertBlocked($owner, 'collections');
        $this->assertBlocked($owner, 'orders');
        $this->assertBlocked($owner, 'riders');
        $this->assertBlocked($owner, 'reviews');

        // What it DOES have: the portfolio/gallery (services module).
        $this->assertReachable($owner, 'gallery');
    }

    // ── 3. PHARMACY: walk-in only, but a full stock chain ───────────

    public function test_pharmacy_tenant_cannot_reach_marketplace_endpoints(): void
    {
        [$shop, $owner] = $this->makeShop('pharmacy');
        $this->assertFalse($shop->featureEnabled('marketplace'));
        $this->assertTrue($shop->featureEnabled('inventory'));

        $this->assertBlocked($owner, 'collections');
        $this->assertBlocked($owner, 'reviews');

        // Batches/expiry are the pharmacy's bread and butter — inventory is on.
        $this->assertReachable($owner, 'inventory');
        $this->assertReachable($owner, 'suppliers');
        $this->assertReachable($owner, 'purchase_orders');
    }

    /**
     * Riders follow DELIVERY, not marketplace. A pharmacy sells nothing online
     * (marketplace=F) yet takes phone orders and delivers them (delivery=T), so
     * it must still manage its riders — gating riders behind marketplace locked
     * out exactly the shop that needed them most.
     */
    public function test_delivering_pharmacy_can_manage_riders_without_an_online_shop(): void
    {
        [$shop, $owner] = $this->makeShop('pharmacy');
        $this->assertFalse($shop->featureEnabled('marketplace'));
        $this->assertTrue($shop->featureEnabled('delivery'));

        $this->assertReachable($owner, 'riders');
        // Still no storefront, though.
        $this->assertBlocked($owner, 'collections');
    }

    /** Turning delivery off closes the riders desk, whatever the type. */
    public function test_riders_are_blocked_without_the_delivery_module(): void
    {
        [, $owner] = $this->makeShop('mart', ['delivery' => false]);

        $this->assertBlocked($owner, 'riders');
        // Marketplace is still on, proving the gate is delivery — not marketplace.
        $this->assertReachable($owner, 'orders');
    }

    // ── 4. MART: the everything-shop ───────────────────────────────

    public function test_mart_tenant_can_reach_inventory_and_marketplace(): void
    {
        [$shop, $owner] = $this->makeShop('mart');
        $this->assertTrue($shop->featureEnabled('inventory'));
        $this->assertTrue($shop->featureEnabled('marketplace'));

        $this->assertReachable($owner, 'inventory');
        $this->assertReachable($owner, 'suppliers');
        $this->assertReachable($owner, 'purchase_orders');
        $this->assertReachable($owner, 'collections');
        $this->assertReachable($owner, 'orders');
        $this->assertReachable($owner, 'riders');
        $this->assertReachable($owner, 'reviews');

        // A grocery has no dining floor and no portfolio.
        $this->assertBlocked($owner, 'dine_in');
        $this->assertBlocked($owner, 'gallery');
    }

    // ── 5/6. RESERVATIONS is retail-only ───────────────────────────

    public function test_retail_tenant_can_reach_reservations(): void
    {
        [$shop, $owner] = $this->makeShop('retail');
        $this->assertTrue($shop->featureEnabled('reservations'));

        $this->assertReachable($owner, 'reservations');
    }

    public function test_non_retail_tenant_cannot_reach_reservations(): void
    {
        foreach (['food', 'mart', 'pharmacy', 'services', 'petroleum'] as $type) {
            [$shop, $owner] = $this->makeShop($type);
            $this->assertFalse($shop->featureEnabled('reservations'), "$type should not reserve");
            $this->assertBlocked($owner, 'reservations');
        }
    }

    // ── 7. PETROLEUM: forecourt, not storefront ────────────────────

    public function test_petroleum_tenant_cannot_reach_marketplace_endpoints(): void
    {
        [$shop, $owner] = $this->makeShop('petroleum');
        $this->assertFalse($shop->featureEnabled('marketplace'));

        $this->assertBlocked($owner, 'collections');
        $this->assertBlocked($owner, 'orders');
        $this->assertBlocked($owner, 'riders');
        $this->assertBlocked($owner, 'reviews');

        // It still runs a stock chain (fuel, lubricants, tyres) and a till.
        $this->assertReachable($owner, 'inventory');
        $this->assertReachable($owner, 'suppliers');

        // The till is reachable too: an unknown barcode gets PAST the module
        // gate and fails in the domain (422 POS_ITEM_NOT_FOUND) rather than
        // 403 MODULE_DISABLED.
        $this->actingAsUser($owner)->getJson(self::PROBE['pos_lookup'])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'POS_ITEM_NOT_FOUND');
    }

    // ── 8. The gate is the FLAG, not the type ──────────────────────

    public function test_disabling_a_module_flag_blocks_its_endpoint_even_for_the_owner(): void
    {
        // A mart normally HAS inventory…
        [, $on] = $this->makeShop('mart');
        $this->assertReachable($on, 'inventory');

        // …but with the flag switched off (admin module toggle) the very same
        // business type is locked out — and the OWNER, who holds every
        // permission, is locked out too.
        [$shop, $off] = $this->makeShop('mart', ['inventory' => false]);
        $this->assertSame('mart', $shop->business_type);
        $this->assertBlocked($off, 'inventory');
        $this->assertBlocked($off, 'suppliers');
        $this->assertBlocked($off, 'purchase_orders');

        // Its other modules are untouched — one flag, one gate.
        $this->assertReachable($off, 'collections');
        $this->assertReachable($off, 'expenses');
    }

    public function test_enabling_a_module_flag_opens_its_endpoint_for_any_type(): void
    {
        // The mirror of the above: a food shop that also stocks packaged goods
        // can be given the inventory module, and the gate opens.
        [, $owner] = $this->makeShop('food', ['inventory' => true]);

        $this->assertReachable($owner, 'inventory');
        $this->assertReachable($owner, 'suppliers');
        $this->assertReachable($owner, 'purchase_orders');
    }

    // ── 9. EXPENSES ────────────────────────────────────────────────

    public function test_expenses_module_off_blocks_expense_endpoints(): void
    {
        // Expenses default ON for every type…
        [, $on] = $this->makeShop('mart');
        $this->assertReachable($on, 'expenses');
        $this->assertReachable($on, 'cashbook');

        // …and switching the module off closes the whole money-ledger half.
        [, $off] = $this->makeShop('mart', ['expenses' => false]);
        $this->assertBlocked($off, 'expenses');
        $this->assertBlocked($off, 'expense_categories');
        $this->assertBlocked($off, 'cashbook');
    }

    // ── 10. GALLERY / PORTFOLIO ────────────────────────────────────

    public function test_gallery_requires_services_module(): void
    {
        // A grocery has no portfolio of work to show.
        [, $mart] = $this->makeShop('mart');
        $this->assertBlocked($mart, 'gallery');

        // A salon/workshop does.
        [, $services] = $this->makeShop('services');
        $this->assertReachable($services, 'gallery');
    }

    // ── A missing flag reads as OFF (parity with EnsureFeature) ────

    /**
     * The books-only tenant: someone who bought ONLY the Expense/Income
     * manager. Everything that sells must be shut — including the POS till,
     * which every other business type gets by default. This is the whole
     * premise of selling Finance Manager standalone.
     */
    public function test_finance_tenant_reaches_only_the_books(): void
    {
        [$shop, $owner] = $this->makeShop('finance');

        // The one module they bought.
        $this->assertReachable($owner, 'expenses');
        $this->assertReachable($owner, 'expense_categories');
        $this->assertReachable($owner, 'cashbook');

        // Everything that sells is off — note pos_lookup: no other type blocks it.
        foreach (['pos_lookup', 'suppliers', 'purchase_orders', 'inventory', 'warranty',
            'collections', 'orders', 'riders', 'reviews', 'reservations',
            'dine_in', 'gallery'] as $probe) {
            $this->assertBlocked($owner, $probe);
        }

        // The till is explicitly OFF despite the platform-wide pos-on default.
        $this->assertFalse($shop->featureEnabled('pos'));
        $this->assertTrue($shop->featureEnabled('expenses'));
    }

    /** A books-only shop has no catalog at all — not even a physical fallback. */
    public function test_finance_tenant_has_no_item_types(): void
    {
        $this->assertSame([], BusinessTypes::itemTypesFor('finance'));
        // The selling types keep theirs (the no-catalog rule must not leak).
        $this->assertContains('physical_product', BusinessTypes::itemTypesFor('mart'));
        $this->assertContains('service', BusinessTypes::itemTypesFor('services'));
    }

    /**
     * Buying the till later is just a flag flip — the type is a starting
     * template, never a cage. Proves upgrade/downgrade works without migration.
     */
    public function test_finance_tenant_can_be_upgraded_with_the_pos_module(): void
    {
        [, $owner] = $this->makeShop('finance', ['pos' => true, 'products' => true]);

        // The till gate now OPENS: the probe scans a code that doesn't exist,
        // so it lands on the controller's own 422 POS_ITEM_NOT_FOUND rather
        // than the module's 403 — reaching business logic IS the proof.
        $this->actingAsUser($owner)->getJson(self::PROBE['pos_lookup'])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'POS_ITEM_NOT_FOUND');
        $this->assertReachable($owner, 'expenses');
        // Still no inventory — modules are granted one at a time.
        $this->assertBlocked($owner, 'suppliers');
    }

    public function test_tenant_with_no_feature_map_is_blocked_from_every_gated_module(): void
    {
        // features = null (a legacy / half-provisioned tenant): every gated
        // module must fail CLOSED, never open.
        $shop = Tenant::factory()->create([
            'business_type' => null, 'features' => null,
            'setup_completed' => true, 'city_id' => $this->city->id,
        ]);
        $owner = User::factory()->shopOwner($shop)->create();

        foreach (['suppliers', 'purchase_orders', 'inventory', 'warranty', 'collections',
            'orders', 'riders', 'reviews', 'reservations', 'dine_in',
            'expenses', 'cashbook', 'gallery', 'pos_lookup'] as $probe) {
            $this->assertBlocked($owner, $probe);
        }
    }
}
