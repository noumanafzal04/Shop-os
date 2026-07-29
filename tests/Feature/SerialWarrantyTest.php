<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\SaleItemSerial;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Serialized retail: capture a serial / IMEI + warranty per unit at the
 * counter, look it up later, and never sell the same serial twice while it's
 * out on a live sale.
 */
class SerialWarrantyTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** A serialized retail good (a phone) with a default warranty. */
    private function phone(float $price = 50000, ?int $warrantyMonths = 12): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Galaxy A55', 'price' => $price, 'stock_quantity' => 100,
            'track_inventory' => true, 'tracks_serial' => true, 'warranty_months' => $warrantyMonths,
        ]);
    }

    /** @param array<int,string> $serials */
    private function sell(Product $p, float $qty, array $serials, array $extra = []): \Illuminate\Testing\TestResponse
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => $qty * (float) $p->price,
            'items' => [array_merge(['product_id' => $p->id, 'quantity' => $qty, 'serials' => $serials], $extra)],
        ]);
    }

    public function test_selling_a_serialized_item_records_serials_with_warranty(): void
    {
        $phone = $this->phone();

        $sale = $this->sell($phone, 2, ['IMEI-AAA', 'IMEI-BBB'])->assertCreated()->json('data');

        $this->assertSame(2, SaleItemSerial::withoutTenancy()->where('sale_id', $sale['id'])->count());

        $serial = SaleItemSerial::withoutTenancy()->where('serial', 'IMEI-AAA')->first();
        $this->assertNotNull($serial);
        $this->assertSame(12, (int) $serial->warranty_months);
        $this->assertNotNull($serial->warranty_expires_at);
        // 12 months from the sale date.
        $this->assertSame(
            $serial->sold_at->copy()->addMonths(12)->toDateString(),
            $serial->warranty_expires_at->toDateString(),
        );
    }

    public function test_warranty_lookup_returns_the_sale_and_status(): void
    {
        $phone = $this->phone();
        $sale = $this->sell($phone, 1, ['IMEI-LOOKUP'])->assertCreated()->json('data');

        $res = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/warranty/lookup?serial=IMEI-LOOKUP')
            ->assertOk()->json('data');

        $this->assertSame('IMEI-LOOKUP', $res['serial']);
        $this->assertSame('Galaxy A55', $res['product_name']);
        $this->assertTrue($res['under_warranty']);
        $this->assertSame($sale['invoice_number'], $res['sale']['invoice_number']);
    }

    public function test_an_unknown_serial_returns_404(): void
    {
        $this->actingAsUser($this->owner)
            ->getJson('/api/v1/warranty/lookup?serial=NOPE')
            ->assertNotFound()
            ->assertJsonPath('meta.error_code', 'SERIAL_NOT_FOUND');
    }

    public function test_the_same_serial_cannot_be_sold_twice(): void
    {
        $phone = $this->phone();
        $this->sell($phone, 1, ['IMEI-DUP'])->assertCreated();

        $this->sell($phone, 1, ['IMEI-DUP'])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'SERIAL_ALREADY_SOLD');
    }

    public function test_serials_cannot_exceed_the_line_quantity(): void
    {
        $phone = $this->phone();

        $this->sell($phone, 1, ['IMEI-1', 'IMEI-2'])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'SERIAL_COUNT_EXCEEDS_QTY');
    }

    public function test_the_same_serial_twice_in_one_sale_is_rejected(): void
    {
        $phone = $this->phone();

        // Two identical serials on a qty-2 line — a keying mistake, not two
        // units. The `distinct` rule rejects it before it can reach the till.
        $this->sell($phone, 2, ['IMEI-SAME', 'IMEI-SAME'])
            ->assertStatus(422)
            ->assertJsonStructure(['errors' => ['items.0.serials.1']]);
    }

    public function test_a_cancelled_sales_serial_can_be_resold(): void
    {
        $phone = $this->phone();
        $sale = $this->sell($phone, 1, ['IMEI-REUSE'])->assertCreated()->json('data');

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/cancel")->assertOk();

        // The unit came back (cancelled sale) — its serial is free to sell again.
        $this->sell($phone, 1, ['IMEI-REUSE'])->assertCreated();
    }

    public function test_a_per_sale_warranty_override_beats_the_product_default(): void
    {
        $phone = $this->phone(warrantyMonths: 12);

        // Floor model — sold with a shorter 6-month warranty just this once.
        $this->sell($phone, 1, ['IMEI-OVERRIDE'], ['warranty_months' => 6])->assertCreated();

        $serial = SaleItemSerial::withoutTenancy()->where('serial', 'IMEI-OVERRIDE')->first();
        $this->assertSame(6, (int) $serial->warranty_months);
    }

    public function test_creating_a_product_with_serial_tracking_via_api(): void
    {
        $res = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product',
            'name' => 'iPhone 15',
            'price' => 300000,
            'tracks_serial' => true,
            'warranty_months' => 12,
        ])->assertCreated()->json('data');

        $this->assertTrue($res['tracks_serial']);
        $this->assertSame(12, (int) $res['warranty_months']);
    }
}
