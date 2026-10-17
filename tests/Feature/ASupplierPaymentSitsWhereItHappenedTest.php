<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\SupplierPayment;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A SUPPLIER PAYMENT SITS IN THE LEDGER WHERE IT HAPPENED.
 *
 * Money pass 2026-10-16 ($4): the pay sheet sends the date picked ("Paid
 * on"), and it was stored at midnight. The Ledger orders a day by the moment
 * of each row, so all three payments of the day — made at 17:39 — came first,
 * and the running balance read −20,000 → −38,712.50 → −39,823.61 before the
 * day's first sale at 17:20. The closing balance was right; every balance
 * above it was fiction, on a screen that says "in the order it happened".
 */
class ASupplierPaymentSitsWhereItHappenedTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $rice;

    private string $supplier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'timezone' => 'Asia/Karachi',
            'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->rice = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice 5kg', 'price' => 1000, 'cost' => 500, 'stock_quantity' => 0, 'track_inventory' => true,
        ]);

        $this->travelTo(CarbonImmutable::parse('2026-10-16 09:00', 'Asia/Karachi'));
        $this->supplier = $this->as()->postJson('/api/v1/suppliers', ['name' => 'Chishtia Wholesale'])->assertCreated()->json('data.id');
        $po = $this->as()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $this->supplier, 'order_date' => '2026-10-16', 'status' => 'ordered',
            'items' => [['product_id' => $this->rice->id, 'quantity' => 20, 'unit_cost' => 500]],
        ])->assertCreated()->json('data');
        $this->as()->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [])->assertOk();
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function sell(float $quantity): void
    {
        $this->as()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'card', 'amount_paid' => 1000 * $quantity,
            'items' => [['product_id' => $this->rice->id, 'quantity' => $quantity]],
        ])->assertCreated();
    }

    /** What the pay sheet sends: an amount, a method, and the date picked. */
    private function pay(float $amount, string $paidOn): void
    {
        $this->as()->postJson("/api/v1/suppliers/{$this->supplier}/payments", [
            'amount' => $amount, 'method' => 'bank_transfer', 'paid_at' => $paidOn,
        ])->assertCreated();
    }

    /** @return list<array<string, mixed>> */
    private function day(string $date): array
    {
        return $this->as()->getJson('/api/v1/ledger?'.http_build_query(['period' => 'custom', 'from' => $date, 'to' => $date]))
            ->assertOk()->json('data');
    }

    public function test_a_payment_made_after_the_days_sales_is_written_after_them(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-16 10:00', 'Asia/Karachi'));
        $this->sell(3);
        $this->travelTo(CarbonImmutable::parse('2026-10-16 18:00', 'Asia/Karachi'));
        $this->pay(2000, '2026-10-16');

        $rows = $this->day('2026-10-16');

        $this->assertSame(['sale', 'supplier_payment'], array_column($rows, 'type'));
        // 3,000 in at ten; 2,000 out at six — never below nothing.
        $this->assertEquals([3000, 1000], array_column($rows, 'balance'));
        $this->assertSame('2026-10-16 13:00:00', SupplierPayment::withoutTenancy()->firstOrFail()->paid_at->utc()->format('Y-m-d H:i:s'));
    }

    public function test_a_payment_dated_another_day_lands_on_that_day(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-17 11:00', 'Asia/Karachi'));
        $this->pay(2000, '2026-10-15');

        $this->assertSame(['supplier_payment'], array_column($this->day('2026-10-15'), 'type'));
        $this->assertSame([], $this->day('2026-10-17'));
    }

    public function test_a_payment_written_before_the_fix_sorts_by_when_it_was_written(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-16 10:00', 'Asia/Karachi'));
        $this->sell(3);
        $this->travelTo(CarbonImmutable::parse('2026-10-16 18:00', 'Asia/Karachi'));
        $this->pay(2000, '2026-10-16');
        // As the old code stored it: the date picked, at midnight.
        SupplierPayment::withoutTenancy()->update(['paid_at' => '2026-10-16 00:00:00']);

        $rows = $this->day('2026-10-16');

        $this->assertSame(['sale', 'supplier_payment'], array_column($rows, 'type'));
        $this->assertEquals([3000, 1000], array_column($rows, 'balance'));
    }
}
