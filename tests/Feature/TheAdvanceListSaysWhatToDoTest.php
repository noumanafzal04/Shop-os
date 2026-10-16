<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\SaleDocument;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE ON-ADVANCE LIST SAYS WHICH ONES TO ACT ON (L17).
 *
 * The owner, 2026-10-15: "agr advance payment li or installment ja rhi usko
 * kaise track kry sb mixed hai". Every open advance looked alike: one paid in
 * full and waiting to be handed over, one nobody has paid into for six weeks,
 * one started yesterday.
 */
class TheAdvanceListSaysWhatToDoTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $fridge;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->fridge = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Fridge', 'sku' => 'FRIDGE', 'price' => 5000, 'cost' => 4000,
            'stock_quantity' => 50, 'track_inventory' => true,
        ]);
    }

    private function asOwner(): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($this->owner->createToken('t', ['access'])->plainTextToken);
    }

    private function hold(string $who, float $deposit, ?string $collectBy = null): string
    {
        return $this->asOwner()->postJson('/api/v1/sale-documents', array_filter([
            'kind' => 'layaway', 'customer_name' => $who, 'customer_phone' => '0300'.random_int(1000000, 9999999),
            'items' => [['product_id' => $this->fridge->id, 'quantity' => 1]],
            'deposit' => ['amount' => $deposit, 'method' => 'card'],
            'expires_at' => $collectBy,
        ]))->assertCreated()->json('data.id');
    }

    private function pay(string $id, float $amount): void
    {
        $this->asOwner()->postJson("/api/v1/sale-documents/{$id}/deposits", ['amount' => $amount, 'method' => 'card'])->assertCreated();
    }

    private function numbersFor(string $status): array
    {
        return array_column($this->asOwner()->getJson("/api/v1/sale-documents?kind=layaway&status={$status}")->assertOk()->json('data'), 'customer_name');
    }

    public function test_paid_up_quiet_and_overdue_are_each_their_own_list(): void
    {
        // Six weeks ago: two held, each with 1,000 down.
        $this->travelTo(now()->subDays(42));
        $silent = $this->hold('Silent Since', 1000, now()->addDays(14)->toDateString());
        $paying = $this->hold('Still Paying', 1000, now()->addDays(60)->toDateString());
        $this->travelBack();

        // Five days ago one of them paid more; ten days ago a third was held and paid off.
        $this->travelTo(now()->subDays(5));
        $this->pay($paying, 1500);
        $this->travelBack();
        $this->travelTo(now()->subDays(10));
        $done = $this->hold('Paid In Full', 2000);
        $this->pay($done, 3000);
        $this->travelBack();
        // Paid off five weeks ago and never collected: waiting, not quiet.
        $this->travelTo(now()->subDays(45));
        $long = $this->hold('Paid Long Ago', 1000, now()->addDays(60)->toDateString());
        $this->travelBack();
        $this->travelTo(now()->subDays(35));
        $this->pay($long, 4000);
        $this->travelBack();
        // And one started today.
        $this->hold('Started Today', 1000);

        $this->assertSame(['Silent Since'], $this->numbersFor('quiet'), 'not paid into for 30 days');
        $this->assertSame(['Paid In Full', 'Paid Long Ago'], $this->numbersFor('paid_up'), 'paid in full, waiting to be handed over');
        $this->assertSame(['Silent Since'], $this->numbersFor('lapsed'), 'past its collect-by date');
        $this->assertCount(5, $this->numbersFor('open'));

        $this->asOwner()->getJson('/api/v1/sale-documents/summary')->assertOk()
            ->assertJsonPath('data.layaway_counts.open', 5)
            ->assertJsonPath('data.layaway_counts.quiet', 1)
            ->assertJsonPath('data.layaway_counts.paid_up', 2)
            ->assertJsonPath('data.layaway_counts.overdue', 1);
    }

    public function test_each_row_says_when_it_was_last_paid_into(): void
    {
        $this->travelTo(now()->subDays(9));
        $id = $this->hold('Paid Nine Days Ago', 1000);
        $this->travelBack();

        $row = collect($this->asOwner()->getJson('/api/v1/sale-documents?kind=layaway')->json('data'))->firstWhere('id', $id);
        $this->assertNotNull($row['last_paid_at']);
        $this->assertSame(now()->subDays(9)->toDateString(), substr($row['last_paid_at'], 0, 10));
        $this->assertSame(1, SaleDocument::withoutTenancy()->count());
    }
}
