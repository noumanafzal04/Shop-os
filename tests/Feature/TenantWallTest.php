<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\DiningTable;
use App\Models\ExpenseCategory;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE SHOP NEXT DOOR CANNOT SEE ANY OF THIS.
 *
 * ── The bug this file exists because of ─────────────────────────────────
 *
 * `BelongsToTenant` filters every query to the current tenant, but only when a
 * tenant CONTEXT EXISTS. Laravel's `SubstituteBindings` lives in the `api`
 * middleware group and therefore ran BEFORE `ResolveTenant` — so a route typed
 *
 *     public function show(DiningTable $table)
 *
 * resolved its model with no context set, the global scope was a no-op, and
 * **any shop's row bound by id**. Found by the sweep's isolation phase on a
 * real pair of shops:
 *
 *     GET /api/v1/restaurant/tables/{another restaurant's table} → 200
 *
 * Somebody else's floor plan, read by name and seat count. Twenty-one
 * controller methods take a bound model and they are not all reads: a bound
 * `update` or `destroy` would have written to it.
 *
 * ── Why it hid ─────────────────────────────────────────────────────────
 *
 * Most controllers do their own lookup — `show(string $id)` then
 * `Model::query()->findOrFail($id)` — which runs INSIDE the stack, after the
 * tenant is known, and refuses with 404 correctly. The two styles sat side by
 * side in the same folder and only one of them was safe, so the safe majority
 * made the whole surface look tested.
 *
 * ── What is asserted, and why 404 rather than 403 ──────────────────────
 *
 * 404. A 403 says "this exists and you may not have it", which confirms a
 * record to a stranger; 404 says nothing at all. Both keep the data in, but
 * only one keeps the SECRET that there is data.
 *
 * The tests below also assert the OWNER still gets 200 for the same id. A wall
 * that refuses everybody is not a wall, it is a broken feature, and the
 * cheapest way to "fix" this bug would be to break dine-in for its own shop.
 */
class TenantWallTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $mine;

    private Tenant $theirs;

    private User $me;

    private User $them;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);

        // Two restaurants, so both sides have the same modules and the same
        // permissions. A refusal only proves isolation when the intruder would
        // otherwise be allowed — refuse them for lacking `dine_in` and the test
        // passes without ever reaching the tenant fence.
        foreach (['mine', 'theirs'] as $which) {
            $tenant = Tenant::factory()->create([
                'setup_completed' => true,
                'city_id' => $city->id,
                'business_type' => 'restaurant',
                'features' => BusinessTypes::defaultFeatures('restaurant'),
                'timezone' => 'UTC',
            ]);
            $this->{$which} = $tenant;
        }

        $this->me = User::factory()->shopOwner($this->mine)->create(['name' => 'My Owner']);
        $this->them = User::factory()->shopOwner($this->theirs)->create(['name' => 'Their Owner']);
    }

    // ── the record the leak was found on ────────────────────────────

    public function test_a_shop_cannot_read_another_shops_dining_table(): void
    {
        $table = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->theirs->id, 'name' => 'T7', 'seats' => 4, 'is_active' => true,
        ]);

        $this->as($this->me)->getJson("/api/v1/restaurant/tables/{$table->id}")
            ->assertStatus(404);
    }

    public function test_and_the_shop_that_owns_it_still_can(): void
    {
        $table = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->theirs->id, 'name' => 'T7', 'seats' => 4, 'is_active' => true,
        ]);

        $this->as($this->them)->getJson("/api/v1/restaurant/tables/{$table->id}")
            ->assertOk()
            ->assertJsonPath('data.name', 'T7');
    }

    public function test_a_shop_cannot_renam_e_another_shops_dining_table(): void
    {
        // The half that would have been silent. A leaked read is somebody
        // seeing your floor; a leaked write is somebody rearranging it.
        $table = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->theirs->id, 'name' => 'T7', 'seats' => 4, 'is_active' => true,
        ]);

        $this->as($this->me)->putJson("/api/v1/restaurant/tables/{$table->id}", ['name' => 'MINE NOW'])
            ->assertStatus(404);

        $this->assertSame('T7', DiningTable::withoutTenancy()->find($table->id)->name);
    }

    public function test_a_shop_cannot_delet_e_another_shops_dining_table(): void
    {
        $table = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->theirs->id, 'name' => 'T7', 'seats' => 4, 'is_active' => true,
        ]);

        $this->as($this->me)->deleteJson("/api/v1/restaurant/tables/{$table->id}")
            ->assertStatus(404);

        $this->assertNotNull(DiningTable::withoutTenancy()->find($table->id));
    }

    // ── and the same question of the OTHER binding style ────────────

    public function test_a_shop_cannot_read_another_shops_product(): void
    {
        // This one always refused — it looks itself up inside the controller,
        // after the tenant is known. It is here so the two styles are asserted
        // side by side and a future controller can be compared against both.
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $this->theirs->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Their Pizza', 'price' => 1000, 'track_inventory' => false, 'is_active' => true,
        ]);

        $this->as($this->me)->getJson("/api/v1/products/{$product->id}")->assertStatus(404);
    }

    public function test_a_shop_cannot_rename_another_shops_expense_category(): void
    {
        // A second BOUND route, on a different model and a different verb, so
        // the fix is shown to be about the ordering rather than about tables.
        $category = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $this->theirs->id, 'name' => 'Their Rent',
        ]);

        $this->as($this->me)->putJson("/api/v1/expense-categories/{$category->id}", ['name' => 'Mine'])
            ->assertStatus(404);

        $this->assertSame('Their Rent', ExpenseCategory::withoutTenancy()->find($category->id)->name);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
