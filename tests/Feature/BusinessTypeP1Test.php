<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductBatch;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * P1 edge cases for the three daily-revenue business types:
 *   FOOD (restaurant)  — serving-window enforcement, shop timezone
 *   MEDICAL (pharmacy) — modifiers blocked, opening stock backed by a lot
 *   MART (grocery)     — fractional-qty guard, tier vs sale price
 */
class BusinessTypeP1Test extends TestCase
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
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => null, // type-less (legacy) tenant: these are ITEM-TYPE capability tests, not business-type-constraint tests
            'features' => BusinessTypes::defaultFeatures('retail'),
            'timezone' => 'Asia/Karachi',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function makeProduct(array $attrs = []): Product
    {
        return Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Item', 'price' => 100, 'stock_quantity' => 50, 'track_inventory' => true,
        ], $attrs));
    }

    // ── FOOD: serving window + timezone ─────────────────────────────

    public function test_food_item_outside_serving_window_is_blocked_at_pos(): void
    {
        // 09:00 UTC = 14:00 Karachi. A 07:00–08:00 breakfast window is over.
        Carbon::setTestNow('2026-07-20 09:00:00');
        $pizza = $this->makeProduct([
            'name' => 'Breakfast Roll', 'item_type' => 'food_item',
            'available_from' => '07:00', 'available_until' => '08:00',
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 100,
            'items' => [['product_id' => $pizza->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'ITEM_NOT_AVAILABLE_NOW');

        // Inside the window (07:30 Karachi = 02:30 UTC) it sells fine.
        Carbon::setTestNow('2026-07-20 02:30:00');
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 100,
            'items' => [['product_id' => $pizza->id, 'quantity' => 1]],
        ])->assertCreated();
    }

    public function test_business_hours_are_evaluated_in_shop_timezone(): void
    {
        // 09:00 UTC → 14:00 in Karachi, 23:00 (prev day) in Honolulu.
        Carbon::setTestNow('2026-07-20 09:00:00');
        $hours = [['day' => now()->setTimezone('Asia/Karachi')->dayOfWeek, 'open' => '13:00', 'close' => '15:00']];

        $pk = Tenant::factory()->create(['timezone' => 'Asia/Karachi', 'business_hours' => $hours]);
        $hi = Tenant::factory()->create(['timezone' => 'Pacific/Honolulu', 'business_hours' => $hours]);

        $this->assertTrue($pk->isOpenNow());   // 14:00 local → within 13:00–15:00
        $this->assertFalse($hi->isOpenNow());  // 23:00 local → closed
    }

    // ── MEDICAL: modifiers blocked, opening lot ─────────────────────

    public function test_modifiers_rejected_on_medicine_but_allowed_on_food(): void
    {
        $med = $this->makeProduct(['name' => 'Panadol', 'item_type' => 'medicine']);
        $food = $this->makeProduct(['name' => 'Burger', 'item_type' => 'food_item']);

        $group = ['groups' => [[
            'name' => 'Extras', 'type' => 'addon', 'min_select' => 0, 'max_select' => 2,
            'options' => [['name' => 'Cheese', 'price_delta' => 50]],
        ]]];

        $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$med->id}/modifier-groups", $group)
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'MODIFIERS_NOT_SUPPORTED');

        $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$food->id}/modifier-groups", $group)
            ->assertOk();
    }

    public function test_medicine_is_findable_by_salt_generic_name(): void
    {
        // Brand name "Calpol", salt "Paracetamol" — searching the salt finds it.
        $this->makeProduct(['name' => 'Calpol', 'item_type' => 'medicine', 'generic_name' => 'Paracetamol 500mg']);
        $this->makeProduct(['name' => 'Brufen', 'item_type' => 'medicine', 'generic_name' => 'Ibuprofen 400mg']);

        $rows = $this->actingAsUser($this->owner)->getJson('/api/v1/products?search=paracetamol')
            ->assertOk()->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame('Calpol', $rows[0]['name']);
    }

    public function test_medicine_opening_stock_is_backed_by_a_batch(): void
    {
        $created = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'medicine', 'name' => 'Amoxil', 'price' => 250,
            'stock_quantity' => 40, 'expiry_date' => now()->addYear()->toDateString(),
        ])->assertCreated()->json('data');

        // Opening stock and the auto-created lot start in step — and the lot is
        // DATED (medicine opening stock requires an expiry).
        $this->assertEquals(40, Product::withoutTenancy()->find($created['id'])->stock_quantity);
        $this->assertNotNull(ProductBatch::withoutTenancy()->where('product_id', $created['id'])->value('expiry_date'));
        $batch = ProductBatch::withoutTenancy()->where('product_id', $created['id'])->firstOrFail();
        $this->assertEquals(40, $batch->quantity);
    }

    public function test_product_images_gated_by_module_but_forced_on_when_online(): void
    {
        \Illuminate\Support\Facades\Storage::fake('public');

        // Walk-in pharmacy: marketplace off → images off → upload blocked.
        $walkIn = Tenant::factory()->create([
            'business_type' => 'pharmacy', 'features' => BusinessTypes::defaultFeatures('pharmacy'),
        ]);
        $this->assertFalse($walkIn->imagesEnabled());
        $owner = User::factory()->shopOwner($walkIn)->create();
        $med = Product::withoutTenancy()->create([
            'tenant_id' => $walkIn->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Tablet', 'price' => 50,
        ]);
        $this->actingAsUser($owner)->postJson("/api/v1/products/{$med->id}/images", [
            'images' => [\Illuminate\Http\UploadedFile::fake()->image('x.jpg')],
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'IMAGES_DISABLED');

        // Same type but selling online → images compulsory → upload allowed.
        $online = Tenant::factory()->create([
            'business_type' => 'pharmacy',
            'features' => array_merge(BusinessTypes::defaultFeatures('pharmacy'), ['marketplace' => true]),
        ]);
        $this->assertTrue($online->imagesEnabled());
        $onlineOwner = User::factory()->shopOwner($online)->create();
        $pid = $this->actingAsUser($onlineOwner)->postJson('/api/v1/products', [
            'item_type' => 'medicine', 'name' => 'Syrup', 'price' => 80,
        ])->assertCreated()->json('data.id');
        $this->actingAsUser($onlineOwner)->postJson("/api/v1/products/{$pid}/images", [
            'images' => [\Illuminate\Http\UploadedFile::fake()->image('y.jpg')],
        ])->assertOk();
    }

    // ── MART: fractional qty + tier vs sale price ───────────────────

    public function test_unit_item_rejects_fractional_quantity_but_weight_item_allows_it(): void
    {
        $unit = $this->makeProduct(['name' => 'Tin', 'sold_by' => 'unit']);
        $weighed = $this->makeProduct(['name' => 'Loose Sugar', 'sold_by' => 'weight']);

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $unit->id, 'quantity' => 2.5]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'FRACTIONAL_QTY_NOT_ALLOWED');

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $weighed->id, 'quantity' => 2.5]],
        ])->assertCreated();
    }

    // ── Edge-case batch: Rx flag, alt barcodes, near-expiry ─────────

    public function test_rx_flag_and_alternate_barcodes_resolve_at_pos(): void
    {
        $created = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'medicine', 'name' => 'Augmentin', 'price' => 300, 'sku' => 'AUG-1',
            'requires_prescription' => true,
            'barcodes' => ['ALT-111', 'ALT-222'],
        ])->assertCreated()->json('data');

        $this->assertTrue(Product::withoutTenancy()->find($created['id'])->requires_prescription);
        $this->assertSame(2, ProductBarcode::withoutTenancy()->where('product_id', $created['id'])->count());

        // Scanning an ALTERNATE barcode resolves the product and flags Rx.
        $this->actingAsUser($this->owner)->getJson('/api/v1/pos/lookup?code=ALT-222')
            ->assertOk()
            ->assertJsonPath('data.product.id', $created['id'])
            ->assertJsonPath('data.requires_prescription', true);
    }

    public function test_duplicate_barcode_across_products_is_rejected(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Cola', 'price' => 80, 'barcodes' => ['DUP-1'],
        ])->assertCreated();

        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Cola Copy', 'price' => 80, 'barcodes' => ['DUP-1'],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'BARCODE_TAKEN');
    }

    public function test_pos_lookup_flags_a_near_expiry_batch(): void
    {
        $med = $this->makeProduct(['name' => 'Insulin', 'item_type' => 'medicine', 'sku' => 'INS-1', 'stock_quantity' => 0]);
        $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'batch_number' => 'NEAR-1', 'expiry_date' => now()->addDays(30)->toDateString(), 'quantity' => 10,
        ])->assertCreated();

        $this->actingAsUser($this->owner)->getJson('/api/v1/pos/lookup?code=INS-1')
            ->assertOk()
            ->assertJsonPath('data.near_expiry.batch_number', 'NEAR-1');

        // A far-future batch does NOT trip the warning.
        $far = $this->makeProduct(['name' => 'Saline', 'item_type' => 'medicine', 'sku' => 'SAL-1', 'stock_quantity' => 0]);
        $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$far->id}/batches", [
            'batch_number' => 'FAR-1', 'expiry_date' => now()->addYear()->toDateString(), 'quantity' => 10,
        ])->assertCreated();
        $this->actingAsUser($this->owner)->getJson('/api/v1/pos/lookup?code=SAL-1')
            ->assertOk()->assertJsonPath('data.near_expiry', null);
    }

    public function test_sale_price_beats_a_higher_bulk_tier(): void
    {
        // Regular 100, flash sale 60, and a bulk tier of 80 at qty ≥ 5.
        // Buying 5 must charge the LOWER 60, not the 80 tier.
        $p = $this->makeProduct([
            'name' => 'Rice', 'price' => 100, 'discount_price' => 60,
            'price_tiers' => [['min_qty' => 5, 'price' => 80]],
        ]);

        $this->assertEquals(60.0, $p->priceForQty(5));

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 10000,
            'items' => [['product_id' => $p->id, 'quantity' => 5]],
        ])->assertCreated()->json('data');

        $this->assertSame('60.00', $sale['items'][0]['unit_price']);
        $this->assertSame('300.00', $sale['total']);
    }
}
