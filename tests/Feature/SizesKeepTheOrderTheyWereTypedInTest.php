<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * SIZES KEEP THE ORDER THEY WERE TYPED IN.
 *
 * Found by carding a kurta in S, M and L and reading it back: L, M, S. A size
 * had a name and no place, so every list of them was sorted by the name — the
 * till's "which size?" sheet, the grid on the edit screen, the labels. Half
 * and Full came back as Full, Half. Nobody hangs a rail in alphabetical order.
 *
 * The names below are chosen so that the typed order and the alphabetical one
 * disagree at every position.
 */
class SizesKeepTheOrderTheyWereTypedInTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private const TYPED = ['S', 'M', 'L', 'XL'];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function kurta(): array
    {
        return $this->asOwner()->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Lawn Kurta', 'price' => 2500, 'track_inventory' => true,
            'variant_axes' => [['name' => 'Size', 'values' => self::TYPED]],
            'variants' => array_map(fn (string $s): array => ['name' => $s, 'price' => 2500, 'stock_quantity' => 3], self::TYPED),
        ])->assertCreated()->json('data');
    }

    /** @return list<string> */
    private function names(array $product): array
    {
        return array_column($product['variants'], 'name');
    }

    public function test_a_design_reads_back_in_the_order_it_was_carded(): void
    {
        $made = $this->kurta();

        $this->assertNotSame(self::TYPED, collect(self::TYPED)->sort()->values()->all(), 'these names would pass sorted by name too');

        $this->assertSame(self::TYPED, $this->names($made));
        // Opened again…
        $this->assertSame(self::TYPED, $this->names($this->asOwner()->getJson("/api/v1/products/{$made['id']}")->json('data')));
        // …on the list…
        $listed = collect($this->asOwner()->getJson('/api/v1/products?search=Lawn')->json('data'))->firstWhere('id', $made['id']);
        $this->assertSame(self::TYPED, $this->names($listed));
        // …and on the till, which is where a cashier is asked "which size?".
        $till = collect($this->asOwner()->getJson('/api/v1/pos/bootstrap')->assertOk()->json('data.products.items'))->firstWhere('id', $made['id']);
        $this->assertSame(self::TYPED, $this->names($till));
    }

    public function test_the_order_follows_the_grid_when_it_is_edited(): void
    {
        $made = $this->kurta();
        $by = collect($made['variants'])->keyBy('name');

        // XS put in at the front, the Large taken out, the rest as they were.
        $now = ['XS', 'S', 'M', 'XL'];
        $this->asOwner()->putJson("/api/v1/products/{$made['id']}", [
            'variants' => array_map(
                fn (string $s): array => [...(isset($by[$s]) ? ['id' => $by[$s]['id']] : []), 'name' => $s, 'price' => 2500],
                $now,
            ),
        ])->assertOk();

        $this->assertSame($now, $this->names($this->asOwner()->getJson("/api/v1/products/{$made['id']}")->json('data')));
    }

    public function test_sizes_that_were_given_no_place_still_read_by_name(): void
    {
        // Written by something that says no order — a seeder, an older build.
        $shirt = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Plain Shirt', 'price' => 900, 'track_inventory' => true,
        ]);
        foreach (['S', 'M', 'L'] as $size) {
            $shirt->variants()->create(['tenant_id' => $this->tenant->id, 'name' => $size, 'price' => 900, 'stock_quantity' => 1]);
        }

        $this->assertSame(['L', 'M', 'S'], $this->names($this->asOwner()->getJson("/api/v1/products/{$shirt->id}")->json('data')));
    }
}
