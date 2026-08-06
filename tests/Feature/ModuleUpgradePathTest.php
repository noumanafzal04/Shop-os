<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\ItemTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Granting a module must make it USABLE, not merely reachable.
 *
 * A business type PROPOSES modules; the admin assigns them per tenant and can
 * change them at any time — that split is the whole reason plans have no say
 * over capability. Every gate on the way in honoured it: `EnsureFeature` reads
 * `tenants.features`, the sidebar reads `tenants.features`, the dashboard reads
 * `tenants.features`.
 *
 * `BusinessTypes::itemTypesFor()` did not. It read this file's static template,
 * so a salon granted `products` — the upgrade the registry's own comment
 * promises works, and for which `services` is even seeded a "Retail Products"
 * category — passed the route gate, was drawn a Catalog, opened the form, and
 * had every save rejected with "this item type isn't available for your
 * business type". A working screen that could not save.
 *
 * These tests walk the grant all the way to a saved row, for every type, so the
 * next module added can't reintroduce a half-open door.
 */
class ModuleUpgradePathTest extends TestCase
{
    use RefreshDatabase;

    private City $city;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
    }

    /** @param  array<string,bool>  $grants */
    private function shop(string $type, array $grants = []): User
    {
        $tenant = Tenant::factory()->create([
            'business_type' => $type,
            'features' => array_merge(BusinessTypes::defaultFeatures($type), $grants),
            'setup_completed' => true,
            'city_id' => $this->city->id,
            'timezone' => 'Asia/Karachi',
        ]);

        return User::factory()->shopOwner($tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /**
     * Every selling type, granted the module it lacks, can save the item type
     * that module unlocks.
     *
     * @return array<string, array{0: string, 1: array<string,bool>, 2: string}>
     */
    public static function grants(): array
    {
        return [
            // A salon that also sells shampoo.
            'services gains goods' => ['services', ['products' => true, 'inventory' => true], ItemTypes::PHYSICAL],
            // A restaurant that starts billing event catering.
            'food gains labour' => ['food', ['services' => true], ItemTypes::SERVICE],
            // A grocery that opens a delivery/handyman desk.
            'mart gains labour' => ['mart', ['services' => true], ItemTypes::SERVICE],
            // A chemist that starts charging for injections/BP checks.
            'pharmacy gains labour' => ['pharmacy', ['services' => true], ItemTypes::SERVICE],
            // An electronics shop that starts billing repairs.
            'retail gains labour' => ['retail', ['services' => true], ItemTypes::SERVICE],
        ];
    }

    #[DataProvider('grants')]
    public function test_a_granted_module_reaches_a_saved_row(string $type, array $grants, string $itemType): void
    {
        $owner = $this->shop($type, $grants);

        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => $itemType,
            'name' => 'Newly possible item',
            'price' => 1500,
        ])->assertCreated()->assertJsonPath('data.item_type', $itemType);
    }

    /**
     * The books-only tenant given a catalog. Nothing about `finance` says what
     * it would sell, so it gets the plain physical product — and, crucially,
     * gets it at all: before, `itemTypesFor('finance')` returned an empty list
     * unconditionally, so the module could be granted and remain unusable
     * forever.
     */
    public function test_a_books_only_tenant_granted_a_catalog_can_fill_it(): void
    {
        $owner = $this->shop('finance', ['products' => true, 'pos' => true]);

        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => ItemTypes::PHYSICAL, 'name' => 'Ledger book', 'price' => 300,
        ])->assertCreated();
    }

    /** Ungranted stays ungranted — the fix must not have opened everything. */
    public function test_a_module_that_was_not_granted_still_blocks_its_item_type(): void
    {
        // A mart never bills labour unless someone turns services on.
        $this->actingAsUser($this->shop('mart'))->postJson('/api/v1/products', [
            'item_type' => ItemTypes::SERVICE, 'name' => 'Home delivery', 'price' => 200,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['item_type']]);

        // And the trade-shaped types stay shut to everyone else, module or not.
        $this->actingAsUser($this->shop('mart', ['services' => true]))->postJson('/api/v1/products', [
            'item_type' => ItemTypes::MEDICINE, 'name' => 'Panadol', 'price' => 50,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['item_type']]);
    }

    /**
     * Taking the catalog module AWAY closes the list again. A grant is a flag,
     * not a migration, and it has to work in both directions.
     */
    public function test_revoking_the_module_closes_the_item_type_again(): void
    {
        $owner = $this->shop('retail', ['products' => false]);

        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => ItemTypes::PHYSICAL, 'name' => 'T-shirt', 'price' => 1200,
        ])->assertForbidden()->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
    }

    /**
     * The panel picks the item type from what the tenant resource publishes, and
     * the server validates against its own computation. If those two ever come
     * from different places the form offers a choice the save rejects — which
     * is exactly how this defect presented.
     */
    public function test_the_tenant_publishes_the_same_list_the_server_enforces(): void
    {
        $owner = $this->shop('services', ['products' => true]);

        $published = $this->actingAsUser($owner)->getJson('/api/v1/auth/me')
            ->assertOk()->json('data.tenant.item_types');

        $this->assertEqualsCanonicalizing(
            [ItemTypes::PHYSICAL, ItemTypes::SERVICE],
            $published,
        );

        // Every type it offers must actually save.
        foreach ($published as $i => $itemType) {
            $this->actingAsUser($owner)->postJson('/api/v1/products', [
                'item_type' => $itemType, 'name' => "Offered {$i}", 'price' => 500,
            ])->assertCreated();
        }
    }

    /** A books-only tenant publishes an empty list, and means it. */
    public function test_a_books_only_tenant_publishes_no_item_types(): void
    {
        $owner = $this->shop('finance');

        $this->assertSame(
            [],
            $this->actingAsUser($owner)->getJson('/api/v1/auth/me')->json('data.tenant.item_types'),
        );
    }

    /**
     * The onboarding picker has no tenant, so it must keep describing types as
     * shipped — an admin choosing a type needs to see what it proposes, not
     * what some shop later turned on.
     */
    public function test_the_type_catalogue_still_describes_the_template(): void
    {
        $this->assertSame(
            [ItemTypes::SERVICE],
            BusinessTypes::itemTypesFor('services'),
        );
        $this->assertSame([], BusinessTypes::itemTypesFor('finance'));
        $this->assertContains(ItemTypes::MEDICINE, BusinessTypes::itemTypesFor('pharmacy'));
        // Legacy codes still answer as the type they became.
        $this->assertContains(ItemTypes::FOOD, BusinessTypes::itemTypesFor('restaurant'));
    }
}
