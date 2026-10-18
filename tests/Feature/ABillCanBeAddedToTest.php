<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Q19 A (the client, 2026-10-17): "a customer bought 8 items, the bill is
 * printed, they want 2 more". The paid bill is never changed. The two are a
 * new ordinary sale that names it — the first bill of the visit — takes its
 * customer, and prints both bills and what they come to together. Only while
 * the customer is at the counter: the same shop-day, the same place.
 */
class ABillCanBeAddedToTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    /** @var array<string, string> */
    private array $item = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->travelTo('2026-10-17 12:00:00');

        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        foreach (['Milk' => 100, 'Bread' => 150] as $name => $price) {
            $this->item[$name] = $this->as()->postJson('/api/v1/products', [
                'name' => $name, 'item_type' => 'physical_product', 'price' => $price, 'track_inventory' => true, 'stock_quantity' => 50,
            ])->assertCreated()->json('data.id');
        }
        $this->as()->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertSuccessful();
    }

    public function test_two_more_items_are_a_new_sale_that_names_the_paid_bill_and_leaves_it_alone(): void
    {
        $first = $this->sell(['Milk' => 8], ['customer_name' => 'Ahmed', 'customer_phone' => '03001234567']);
        $before = Sale::query()->with('items')->findOrFail($first['id'])->toArray();

        $added = $this->sell(['Bread' => 2], ['adds_to_sale_id' => $first['id']]);

        $this->assertSame($first['id'], $added['adds_to_sale_id']);
        $this->assertSame('03001234567', $added['customer_phone'], 'one customer, one visit');
        $this->assertEquals(300, $added['total']);
        $this->assertSame([$first['invoice_number'], $added['invoice_number']], array_column($added['visit']['bills'], 'invoice_number'));
        $this->assertEquals(1100, $added['visit']['together']);

        $after = Sale::query()->with('items')->findOrFail($first['id'])->toArray();
        $this->assertSame($before, $after, 'the paid bill was changed');

        $this->assertEquals(1100, $this->as()->getJson("/api/v1/sales/{$first['id']}")->assertOk()->json('data.visit.together'));

        $paper = $this->as()->get("/api/v1/sales/{$added['id']}/invoice")->assertOk();
        $paper->assertSee("Added to {$first['invoice_number']}")->assertSee('Both bills together');
        $this->assertMatchesRegularExpression('/Both bills together<\/td><td class="num">[^<]*1,100/', $paper->getContent());
    }

    public function test_adding_to_an_addition_hangs_off_the_first_bill(): void
    {
        $first = $this->sell(['Milk' => 8]);
        $second = $this->sell(['Bread' => 2], ['adds_to_sale_id' => $first['id']]);

        $third = $this->sell(['Milk' => 1], ['adds_to_sale_id' => $second['id']]);

        $this->assertSame($first['id'], $third['adds_to_sale_id']);
        $this->assertCount(3, $third['visit']['bills']);
        $this->assertEquals(1200, $third['visit']['together']);
        $this->as()->get("/api/v1/sales/{$first['id']}/invoice")->assertOk()
            ->assertSee('Items added to this bill later')->assertSee('All 3 bills together');

        // A bill cancelled since is named, and not part of what was paid for.
        DB::table('sales')->where('id', $third['id'])->update(['status' => 'cancelled']);
        $this->assertEquals(1100, $this->as()->getJson("/api/v1/sales/{$first['id']}")->json('data.visit.together'));
        $this->as()->get("/api/v1/sales/{$first['id']}/invoice")->assertSee("{$third['invoice_number']}  — cancelled", false);
    }

    public function test_only_while_the_customer_is_at_the_counter(): void
    {
        $this->travelTo('2026-10-16 15:00:00');
        $yesterday = $this->sell(['Milk' => 1]);
        $this->travelTo('2026-10-17 12:00:00');
        $cancelled = $this->sell(['Milk' => 1]);
        DB::table('sales')->where('id', $cancelled['id'])->update(['status' => 'cancelled']);
        $elsewhere = $this->sell(['Milk' => 1]);
        $outlet = Branch::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Outlet']);
        DB::table('sales')->where('id', $elsewhere['id'])->update(['branch_id' => $outlet->id]);
        $practice = $this->sell(['Milk' => 1]);
        DB::table('sales')->where('id', $practice['id'])->update(['is_training' => true]);
        $strangers = Tenant::factory()->provisioned()->create(['setup_completed' => true, 'business_type' => 'mart']);
        $theirs = Sale::withoutTenancy()->where('tenant_id', '!=', $this->shop->id)->value('id')
            ?? $this->strangersBill($strangers);
        $count = Sale::withoutTenancy()->count();

        foreach ([
            'BILL_DAY_OVER' => $yesterday['id'],
            'BILL_CANCELLED' => $cancelled['id'],
            'BILL_ELSEWHERE' => $elsewhere['id'],
            'BILL_PRACTICE' => $practice['id'],
            'BILL_NOT_FOUND' => $theirs,
        ] as $code => $bill) {
            $this->attempt(['Bread' => 1], ['adds_to_sale_id' => $bill])->assertStatus(422)->assertJsonPath('meta.error_code', $code);
        }

        $this->assertSame($count, Sale::withoutTenancy()->count(), 'a refused addition rang a sale anyway');
    }

    /** The bill found in Sales later the same day says whether it can still be added to. */
    public function test_the_sale_says_whether_it_can_still_be_added_to(): void
    {
        $this->travelTo('2026-10-16 15:00:00');
        $yesterday = $this->sell(['Milk' => 1]);
        $this->travelTo('2026-10-17 12:00:00');
        $today = $this->sell(['Milk' => 1]);
        $addition = $this->sell(['Bread' => 1], ['adds_to_sale_id' => $today['id']]);
        $cancelled = $this->sell(['Milk' => 1]);
        DB::table('sales')->where('id', $cancelled['id'])->update(['status' => 'cancelled']);

        $addTo = fn (array $sale) => $this->as()->getJson("/api/v1/sales/{$sale['id']}")->assertOk()->json('data.add_to');

        $this->assertSame(['open' => true, 'why_not' => null], $addTo($today));
        $this->assertSame(['open' => true, 'why_not' => null], $addTo($addition), 'an addition is added to through its first bill');
        $this->assertFalse($addTo($yesterday)['open']);
        $this->assertStringContainsString('another day', $addTo($yesterday)['why_not']);
        $this->assertStringContainsString('cancelled', $addTo($cancelled)['why_not']);
    }

    public function test_the_offline_door_cannot_add_to_a_bill_from_another_day(): void
    {
        $this->travelTo('2026-10-16 15:00:00');
        $yesterday = $this->sell(['Milk' => 1]);
        $this->travelTo('2026-10-17 12:00:00');

        $this->as()->postJson('/api/v1/pos/sync', [
            'operations' => [[
                'op' => (string) Str::uuid(), 'at' => now()->subMinutes(5)->toIso8601String(), 'offline_number' => 'OFF-L1-AB-000001',
                'sale' => ['channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 150, 'adds_to_sale_id' => $yesterday['id'],
                    'items' => [['product_id' => $this->item['Bread'], 'quantity' => 1]]],
            ]],
        ])->assertOk();

        $this->assertSame(0, Sale::query()->where('adds_to_sale_id', $yesterday['id'])->count());
    }

    /** @param array<string, int> $lines */
    private function sell(array $lines, array $extra = []): array
    {
        return $this->attempt($lines, $extra)->assertCreated()->json('data');
    }

    /** @param array<string, int> $lines */
    private function attempt(array $lines, array $extra = []): TestResponse
    {
        $items = [];
        $total = 0;
        foreach ($lines as $name => $quantity) {
            $items[] = ['product_id' => $this->item[$name], 'quantity' => $quantity];
            $total += $quantity * ($name === 'Milk' ? 100 : 150);
        }

        return $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => $total, 'items' => $items, ...$extra,
        ]);
    }

    private function strangersBill(Tenant $strangers): string
    {
        $owner = User::factory()->shopOwner($strangers)->create();
        $this->app['auth']->forgetGuards();
        $id = $this->withToken($owner->createToken('t', ['access'])->plainTextToken)->postJson('/api/v1/products', [
            'name' => 'Theirs', 'item_type' => 'physical_product', 'price' => 10, 'track_inventory' => false,
        ])->assertCreated()->json('data.id');
        $this->app['auth']->forgetGuards();

        return $this->withToken($owner->createToken('t', ['access'])->plainTextToken)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 10, 'items' => [['product_id' => $id, 'quantity' => 1]],
        ])->assertCreated()->json('data.id');
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
