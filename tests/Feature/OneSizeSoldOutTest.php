<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE LARGE RAN OUT. THE SMALL DID NOT.
 *
 * Eighty-sixing was a decision about a PRODUCT, so a pizzeria that ran out of
 * large bases had one move: take the whole pizza off. Small and Medium went with
 * it, all evening, on the busiest item on the menu.
 *
 * A size is what a customer orders and what a kitchen runs out of, so it is the
 * thing that has to be markable. The product-level flag is untouched — "no pizza
 * tonight" is still a sentence a shop needs, and it is not the same sentence.
 *
 * The rule lives in `App\Support\SoldOut` because THREE paths sell — the
 * counter, an online order and a dine-in tab — and that has cost this shop
 * before: `ITEM_SOLD_OUT` was enforced by the till alone for a while, so the app
 * took the order anyway and the tab printed a kitchen ticket for a dish that was
 * off. Three copies of a two-part rule is three chances to check the product and
 * forget the size.
 */
class OneSizeSoldOutTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function login(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function pizza(): array
    {
        return $this->login()->postJson('/api/v1/products', [
            'name' => 'Pizza', 'item_type' => 'physical_product', 'price' => 900,
            'track_inventory' => true,
            'variants' => [
                ['name' => 'Small', 'price' => 700, 'stock_quantity' => 10],
                ['name' => 'Large', 'price' => 1200, 'stock_quantity' => 10],
            ],
        ])->assertCreated()->json('data');
    }

    private function sizeOf(array $p, string $name): string
    {
        return collect($p['variants'])->firstWhere('name', $name)['id'];
    }

    private function ring(array $p, string $variantId, int $expect)
    {
        return $this->login()->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $p['id'], 'variant_id' => $variantId, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 2000,
        ])->assertStatus($expect);
    }

    public function test_one_size_goes_off_and_the_others_keep_selling(): void
    {
        $pizza = $this->pizza();
        $large = $this->sizeOf($pizza, 'Large');
        $small = $this->sizeOf($pizza, 'Small');

        $this->login()->postJson("/api/v1/products/{$pizza['id']}/variants/{$large}/sold-out")->assertOk();

        $res = $this->ring($pizza, $large, 422);
        $this->assertSame('ITEM_SOLD_OUT', $res->json('meta.error_code'));

        // The whole point. Taking the Large off must not cost the evening's
        // Small sales, which is what the product-level flag did.
        $this->ring($pizza, $small, 201);
    }

    public function test_the_first_time_is_the_one_that_is_kept(): void
    {
        // "Off since Tuesday" is the reason this stores a time and not a flag.
        $pizza = $this->pizza();
        $large = $this->sizeOf($pizza, 'Large');

        $this->login()->postJson("/api/v1/products/{$pizza['id']}/variants/{$large}/sold-out")->assertOk();
        $first = ProductVariant::query()->find($large)->sold_out_at;

        $this->travel(2)->hours();
        $this->login()->postJson("/api/v1/products/{$pizza['id']}/variants/{$large}/sold-out")->assertOk();

        $this->assertEquals($first, ProductVariant::query()->find($large)->sold_out_at,
            're-pressing erased how long it had been off');
    }

    public function test_it_goes_back_on(): void
    {
        $pizza = $this->pizza();
        $large = $this->sizeOf($pizza, 'Large');

        $this->login()->postJson("/api/v1/products/{$pizza['id']}/variants/{$large}/sold-out")->assertOk();
        $this->login()->deleteJson("/api/v1/products/{$pizza['id']}/variants/{$large}/sold-out")->assertOk();

        $this->ring($pizza, $large, 201);
    }

    public function test_a_size_cannot_be_86d_through_another_product(): void
    {
        // Route model binding resolves both independently. Without the check the
        // reply would name one product while the flag landed on another's size.
        $pizza = $this->pizza();
        $other = $this->pizza();

        $this->login()->postJson(
            "/api/v1/products/{$other['id']}/variants/{$this->sizeOf($pizza, 'Large')}/sold-out"
        )->assertStatus(404);
    }

    public function test_the_product_flag_still_takes_everything_off(): void
    {
        // Unchanged, and it has to be: "no pizza tonight" is a real sentence.
        $pizza = $this->pizza();

        $this->login()->postJson("/api/v1/products/{$pizza['id']}/sold-out")->assertOk();

        $this->ring($pizza, $this->sizeOf($pizza, 'Small'), 422);
        $this->ring($pizza, $this->sizeOf($pizza, 'Large'), 422);
    }

    public function test_the_till_is_told_which_size_is_off(): void
    {
        // The server refuses the line either way; this is so the sheet can grey
        // it out BEFORE a waiter has promised it to a table.
        $pizza = $this->pizza();
        $large = $this->sizeOf($pizza, 'Large');
        $this->login()->postJson("/api/v1/products/{$pizza['id']}/variants/{$large}/sold-out")->assertOk();

        $res = $this->login()->getJson('/api/v1/pos/catalog')->assertOk();

        $row = collect($res->json('data.products.items'))->firstWhere('id', $pizza['id']);
        $this->assertNotNull($row, 'the till was not sent this product at all');

        $sizes = collect($row['variants']);
        $this->assertTrue((bool) $sizes->firstWhere('id', $large)['sold_out']);
        $this->assertFalse((bool) $sizes->firstWhere('name', 'Small')['sold_out']);
    }
}
