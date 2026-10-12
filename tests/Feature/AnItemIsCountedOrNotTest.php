<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * AN ITEM IS COUNTED, OR IT IS NOT — and a shop can change its mind.
 *
 * ── What was found ───────────────────────────────────────────────────
 *
 * A new restaurant carded its first dish and could not sell it. The dish was
 * born COUNTED (`track_inventory`) at a stock of zero, so every table read
 * "none left" — the item form had sent its own default before it had been
 * told what a dish is. And the switch on that form, "Track stock for this
 * item", could not put it right: on an item that existed the form never sent
 * it and the request prohibited it. It flipped, saved, and flipped back.
 *
 * The tests are in the order a shop would meet them.
 */
class AnItemIsCountedOrNotTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'food',
            // A restaurant that counts its stock: the one whose dishes use up rice.
            'features' => ['inventory' => true] + BusinessTypes::defaultFeatures('food'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function item(string $name, array $more = []): Product
    {
        return Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => 100, 'cost' => 60, 'stock_quantity' => 0, 'track_inventory' => true, 'is_active' => true,
        ], $more));
    }

    /** A dish as the form made the first one: counted, with nothing to count. */
    private function dishBornCounted(): Product
    {
        return $this->item('Chicken Biryani', ['item_type' => 'food_item', 'price' => 450]);
    }

    private function edit(Product $product, array $with): TestResponse
    {
        return $this->asOwner()->putJson("/api/v1/products/{$product->id}", $with);
    }

    private function sell(Product $product, float $quantity = 1): TestResponse
    {
        return $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 999999,
            'items' => [['product_id' => $product->id, 'quantity' => $quantity]],
        ]);
    }

    // ── what the shop met ─────────────────────────────────────────────

    public function test_a_dish_that_was_born_counted_is_put_right_by_its_own_switch_and_can_then_be_sold(): void
    {
        $dish = $this->dishBornCounted();

        // As it stood: nothing on the shelf, so nothing to sell.
        $this->sell($dish)->assertStatus(422)->assertJsonPath('meta.error_code', 'INSUFFICIENT_STOCK');

        $saved = $this->edit($dish, ['track_inventory' => false])->assertOk();

        $this->assertFalse($saved->json('data.track_inventory'), 'the answer still says the dish is counted');
        $this->assertFalse((bool) $dish->fresh()->track_inventory, 'the switch was accepted and not kept');
        // Nothing was on the books, so there is nothing to say about the books.
        $this->assertSame([], $saved->json('meta.warnings') ?? []);

        $this->sell($dish)->assertCreated();
    }

    public function test_an_edit_that_says_nothing_about_counting_changes_nothing_about_it(): void
    {
        $counted = $this->item('Cola 1.5L', ['stock_quantity' => 24]);
        $made = $this->item('Mint Lemonade', ['item_type' => 'food_item', 'track_inventory' => false]);

        $this->edit($counted, ['name' => 'Cola 1.5 litre'])->assertOk();
        $this->edit($made, ['name' => 'Mint Lemonade (fresh)'])->assertOk();

        $this->assertTrue((bool) $counted->fresh()->track_inventory);
        $this->assertFalse((bool) $made->fresh()->track_inventory);
        $this->assertEquals(24.0, (float) $counted->fresh()->stock_quantity);
    }

    public function test_saying_what_it_already_is_is_not_a_change(): void
    {
        $counted = $this->item('Cola 1.5L', ['stock_quantity' => 24]);

        $saved = $this->edit($counted, ['track_inventory' => true])->assertOk();

        $this->assertSame([], $saved->json('meta.warnings') ?? []);
        $this->assertTrue((bool) $counted->fresh()->track_inventory);
    }

    // ── the number is not the switch's to change ──────────────────────

    public function test_stopping_keeps_the_last_figure_on_record_and_says_so(): void
    {
        $cola = $this->item('Cola 1.5L', ['stock_quantity' => 12]);

        $saved = $this->edit($cola, ['track_inventory' => false])->assertOk();

        $this->assertFalse((bool) $cola->fresh()->track_inventory);
        $this->assertEquals(12.0, (float) $cola->fresh()->stock_quantity, 'a switch moved stock, with no reason and no name on it');
        $this->assertSame(
            ['Cola 1.5L is no longer counted. The 12 on the books stay on record, and are left out of the stock value.'],
            $saved->json('meta.warnings'),
        );

        // Not counted: it sells however many, and the figure does not move.
        $this->sell($cola, 40)->assertCreated();
        $this->assertEquals(12.0, (float) $cola->fresh()->stock_quantity);
    }

    public function test_starting_counts_from_what_the_books_hold_and_a_dish_with_none_is_told_it_is_out(): void
    {
        $dish = $this->item('Mint Lemonade', ['item_type' => 'food_item', 'track_inventory' => false]);
        $kept = $this->item('Cola 1.5L', ['stock_quantity' => 12, 'track_inventory' => false]);

        $none = $this->edit($dish, ['track_inventory' => true])->assertOk();
        $some = $this->edit($kept, ['track_inventory' => true])->assertOk();

        $this->assertSame(
            ['Mint Lemonade is counted from now and there is none on the books — it is out of stock until some is added on the Inventory screen.'],
            $none->json('meta.warnings'),
        );
        $this->assertSame(['Cola 1.5L is counted again, from the 12 on the books.'], $some->json('meta.warnings'));

        // And it means it: the dish is out, the cola sells down from twelve.
        $this->sell($dish)->assertStatus(422)->assertJsonPath('meta.error_code', 'INSUFFICIENT_STOCK');
        $this->sell($kept, 2)->assertCreated();
        $this->assertEquals(10.0, (float) $kept->fresh()->stock_quantity);
    }

    // ── what something else is counting on ────────────────────────────

    public function test_an_ingredient_of_a_dish_cannot_stop_being_counted_and_the_refusal_says_how_many_dishes(): void
    {
        $rice = $this->item('Basmati Rice', ['stock_quantity' => 10]);
        $biryani = $this->item('Chicken Biryani', ['item_type' => 'food_item', 'track_inventory' => false]);
        $pulao = $this->item('Pulao', ['item_type' => 'food_item', 'track_inventory' => false]);
        foreach ([$biryani, $pulao] as $dish) {
            $this->edit($dish, ['recipe_items' => [['ingredient_product_id' => $rice->id, 'quantity' => 0.25]]])->assertOk();
        }

        $this->edit($rice, ['track_inventory' => false, 'name' => 'Rice'])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'STOCK_COUNT_REQUIRED')
            // Named as the form now reads — it was renamed in the same edit.
            ->assertJsonPath('message', 'Rice is an ingredient of 2 dishes. A dish cannot use up something nobody counts — take it out of those recipes first.');

        $rice->refresh();
        $this->assertTrue((bool) $rice->track_inventory);
        // The whole edit is refused, not the switch alone: the form is never half-saved behind an error.
        $this->assertSame('Basmati Rice', $rice->name);

        // Out of both recipes, and it may stop.
        foreach ([$biryani, $pulao] as $dish) {
            $this->edit($dish, ['recipe_items' => []])->assertOk();
        }
        $this->edit($rice, ['track_inventory' => false])->assertOk();
        $this->assertFalse((bool) $rice->fresh()->track_inventory);
    }

    public function test_a_unit_sold_by_its_serial_number_is_always_counted(): void
    {
        $phone = $this->item('Phone X', ['stock_quantity' => 3, 'tracks_serial' => true]);

        $this->edit($phone, ['track_inventory' => false])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'STOCK_COUNT_REQUIRED')
            ->assertJsonPath('message', 'Phone X is sold by its serial number, so every unit of it is counted.');

        $this->assertTrue((bool) $phone->fresh()->track_inventory);
    }

    public function test_a_dated_lot_on_the_shelf_keeps_its_item_counted_until_the_lot_is_gone(): void
    {
        $syrup = $this->item('Cough Syrup', ['item_type' => 'medicine', 'stock_quantity' => 6]);
        $lot = ProductBatch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'product_id' => $syrup->id, 'batch_number' => 'B-1',
            'quantity' => 6, 'expiry_date' => now()->addYear()->toDateString(),
        ]);

        $this->edit($syrup, ['track_inventory' => false])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'STOCK_COUNT_REQUIRED')
            ->assertJsonPath('message', 'Cough Syrup has 1 dated lot on the shelf. Sell or write them off first — a lot nobody counts cannot run out or expire.');
        $this->assertTrue((bool) $syrup->fresh()->track_inventory);

        // The lot is empty: nothing dated is left to count.
        $lot->forceFill(['quantity' => 0])->save();
        $this->edit($syrup, ['track_inventory' => false])->assertOk();
        $this->assertFalse((bool) $syrup->fresh()->track_inventory);
    }

    public function test_a_service_has_nothing_to_count(): void
    {
        $service = $this->item('Home Delivery', ['type' => 'service', 'item_type' => 'service', 'track_inventory' => false]);

        $this->edit($service, ['track_inventory' => true])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'STOCK_NOT_COUNTED_FOR_TYPE')
            ->assertJsonPath('message', 'Home Delivery is not something a shelf holds, so there is nothing to count.');

        $this->assertFalse((bool) $service->fresh()->track_inventory);
    }

    // ── and an item nobody said anything about is born right ──────────

    public function test_made_with_nothing_said_a_dish_is_not_counted_and_a_packet_is(): void
    {
        $made = fn (string $type, string $name) => $this->asOwner()->postJson('/api/v1/products', [
            'item_type' => $type, 'name' => $name, 'price' => 100, 'description' => 'made with nothing said about stock',
        ])->assertCreated()->json('data');

        // What the form now relies on while it has not been told what a dish is: say nothing.
        $this->assertFalse($made('food_item', 'Seekh Kebab')['track_inventory'], 'a dish was born counted');
        $this->assertTrue($made('physical_product', 'Cola 1.5L')['track_inventory'], 'a packet was born uncounted');
    }
}
