<?php

namespace Tests\Feature;

use App\Models\BusinessDay;
use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * B14: A DAY'S "RUNG UP" WAS ITS DRAWERS.
 *
 * Main's day said 22,690 from 6 sales while Main had sold 31,580 in 8 — the
 * two sold with no shift open were in the shop's revenue and in no day. They
 * are the day's sales now, said apart, and never in a drawer's expected cash.
 */
final class ADayCountsWhatNoDrawerTookTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'setup_completed' => true,
            'timezone' => 'Asia/Karachi',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $this->at('2026-10-06 09:00');
        $id = $this->as()->postJson('/api/v1/products', [
            'name' => 'Day Item', 'type' => 'product', 'item_type' => 'physical_product',
            'price' => 100, 'cost' => 60, 'track_inventory' => false,
        ])->assertCreated()->json('data.id');
        $this->item = Product::withoutTenancy()->findOrFail($id);
    }

    public function test_a_sale_no_drawer_took_is_in_the_day_and_in_no_drawer(): void
    {
        $this->as()->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertCreated();
        $this->sell(3);                                              // 300, in the drawer
        $this->as()->postJson('/api/v1/pos/session/close', ['counted_cash' => 1300])->assertOk();

        $this->at('2026-10-06 15:00');
        $this->sell(2);                                              // 200, no shift open

        $day = $this->as()->getJson('/api/v1/pos/day')->assertOk()->json('data');
        $this->assertEquals(500, $day['running']['sales_total'], "a sale with no shift was left out of the day's takings");
        $this->assertSame(2, $day['running']['sales_count']);
        $this->assertEquals(['sales_count' => 1, 'sales_total' => 200], $day['running']['away_from_drawers']);
        // The drawer is told only what it took.
        $this->assertEquals(1300, $day['running']['expected_cash']);

        $this->at('2026-10-06 22:00');
        $this->as()->postJson("/api/v1/pos/days/{$day['day']['id']}/close", [])->assertOk()
            ->assertJsonPath('data.sales_total', '500.00')
            ->assertJsonPath('data.sales_count', 2)
            ->assertJsonPath('data.expected_cash', '1300.00');
    }

    public function test_another_night_is_not_this_day(): void
    {
        // The evening before: the 5th's, whoever counts it.
        $this->at('2026-10-05 20:00');
        $this->sell(5);

        $this->at('2026-10-06 09:00');
        $this->as()->postJson('/api/v1/pos/session/open', ['opening_float' => 0])->assertCreated();
        $this->sell(1);
        $this->as()->postJson('/api/v1/pos/session/close', ['counted_cash' => 100])->assertOk();

        // Half past four the next morning is still the 6th's night (the day
        // turns at five); a quarter past five is the 7th.
        $this->at('2026-10-07 04:30');
        $this->sell(2);
        $this->at('2026-10-07 05:15');
        $this->sell(4);

        $this->at('2026-10-07 05:20');
        $sixth = BusinessDay::withoutTenancy()->where('tenant_id', $this->shop->id)->sole();
        $this->assertSame('2026-10-06', $sixth->trading_date->toDateString());
        // 100 in the drawer, 200 before five; the 500 the evening before is the
        // 5th's and the 400 after five is the 7th's.
        $this->as()->postJson("/api/v1/pos/days/{$sixth->id}/close", [])->assertOk()
            ->assertJsonPath('data.sales_total', '300.00')
            ->assertJsonPath('data.sales_count', 2);
    }

    private function at(string $wall): void
    {
        $this->travelTo(Carbon::parse($wall, 'Asia/Karachi'));
    }

    private function sell(int $qty): void
    {
        $this->as()->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $this->item->id, 'quantity' => $qty]],
            'payment_method' => 'cash',
            'amount_paid' => $qty * 100,
        ])->assertCreated();
    }

    private function as(): static
    {
        $this->defaultHeaders = [];
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
