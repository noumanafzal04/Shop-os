<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * The retail flow (2026-10-21, docs/qa/TESTER-REPORT-2026-10-20-retail-flow.md):
 * each thing the tester found, asked the way the tester asked it.
 */
class TheRetailFlowHoldsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $cashier;

    /** @var array<string, string> */
    private array $item = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->travelTo(Carbon::parse('2026-10-21 15:00:00', 'Asia/Karachi'));

        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->cashier = User::factory()->tenantStaff($this->shop, ['sales.manage', 'discounts.apply'])->create(['name' => 'Kamran']);
    }

    /** #5: the same money off the same bill is one answer, whichever box it is typed into. */
    public function test_a_line_discount_and_a_bill_discount_meet_the_same_limit(): void
    {
        $this->as($this->owner)->putJson('/api/v1/shop/settings', ['max_discount_percent' => 10])->assertOk();
        $this->product('Bath Towel', 899.99);
        $this->as($this->cashier)->postJson('/api/v1/pos/session/open', ['opening_float' => 0])->assertSuccessful();
        $bill = fn (float $off, bool $onTheLine): TestResponse => $this->as($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'card', 'amount_paid' => round(1799.98 - $off, 2),
            'discount' => $onTheLine ? 0 : $off,
            'items' => [['product_id' => $this->item['Bath Towel'], 'quantity' => 2] + ($onTheLine ? ['line_discount' => $off] : [])],
        ]);

        // 179.98 off 1,799.98 is 9.999 %: inside 10 %, on the line as on the bill.
        $bill(179.98, onTheLine: true)->assertCreated();
        $bill(179.98, onTheLine: false)->assertCreated();

        // 181 is past it, either way — and the refusal names the till's own figure.
        $bill(181, onTheLine: true)->assertForbidden()->assertJsonPath('meta.error_code', 'DISCOUNT_LIMIT_EXCEEDED')
            ->assertJsonFragment(['message' => 'This discount is 10.06% — above the 10% limit. A manager has to approve it.']);
        $bill(181, onTheLine: false)->assertForbidden()->assertJsonPath('meta.error_code', 'DISCOUNT_LIMIT_EXCEEDED');
    }

    /** #11: "Still in the shop" is the drawers less the bank, never below what is there. */
    public function test_still_in_the_shop_is_the_drawers_less_what_was_banked(): void
    {
        $this->product('Mug', 1000);
        $this->as($this->cashier)->postJson('/api/v1/pos/session/open', ['opening_float' => 5000])->assertSuccessful();
        $this->as($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 3000,
            'items' => [['product_id' => $this->item['Mug'], 'quantity' => 3]],
        ])->assertCreated();
        // Cash that is not a sale: it is in the drawer, and it goes to the bank with it.
        $this->as($this->cashier)->postJson('/api/v1/pos/session/movements', ['type' => 'paid_in', 'amount' => 1500, 'reason' => 'Owner top-up'])->assertSuccessful();

        // The drawer holds 9,500; 6,500 of it is banked, the 3,000 float stays.
        $this->as($this->owner)->postJson('/api/v1/pos/deposits', ['amount' => 6500, 'bank_name' => 'Meezan'])->assertCreated();

        $view = $this->as($this->owner)->getJson('/api/v1/pos/day')->assertOk()->json('data');
        $this->assertEquals(9500, $view['running']['expected_cash']);
        $this->assertEquals(3000, $view['unbanked'], 'It read cash sales less banked: −3,500.');
    }

    /** #6: the Dashboard's "Banked today" is today's trading day, as Day & banking says. */
    public function test_banked_today_is_the_banking_of_todays_trading_day(): void
    {
        $this->product('Mug', 1000);
        $shift = $this->as($this->cashier)->postJson('/api/v1/pos/session/open', ['opening_float' => 0])->assertSuccessful()->json('data');
        $this->as($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 4000,
            'items' => [['product_id' => $this->item['Mug'], 'quantity' => 4]],
        ])->assertCreated();
        $this->as($this->cashier)->postJson('/api/v1/pos/session/close', ['counted_cash' => 4000])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/pos/days/{$shift['business_day_id']}/close", [])->assertOk();

        // The next morning, yesterday's takings go to the bank — filed under yesterday.
        $this->travelTo(Carbon::parse('2026-10-22 11:45:00', 'Asia/Karachi'));
        $slip = $this->as($this->owner)->postJson('/api/v1/pos/deposits', ['amount' => 4000, 'bank_name' => 'Meezan'])->assertCreated()->json('data');
        $this->assertSame($shift['business_day_id'], $slip['business_day_id']);

        $till = fn (): array => $this->as($this->owner)->getJson('/api/v1/dashboard')->assertOk()->json('data.till');
        $this->assertEquals(0, $till()['banked_today'], "Yesterday's banking read as today's.");

        // Today's own banking is today's.
        $this->as($this->cashier)->postJson('/api/v1/pos/session/open', ['opening_float' => 0])->assertSuccessful();
        $this->as($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $this->item['Mug'], 'quantity' => 1]],
        ])->assertCreated();
        $this->as($this->owner)->postJson('/api/v1/pos/deposits', ['amount' => 1000, 'bank_name' => 'Meezan'])->assertCreated();
        $this->assertEquals(1000, $till()['banked_today']);
        $this->assertEquals(1000, $this->as($this->owner)->getJson('/api/v1/pos/day')->json('data.banked'));
    }

    /** The user, 2026-10-21: a parent category's filter finds its sub-categories' items, everywhere. */
    public function test_a_parent_category_finds_the_items_filed_under_its_children(): void
    {
        $men = $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Men'])->assertCreated()->json('data.id');
        $shirts = $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Shirts', 'parent_id' => $men])->assertCreated()->json('data.id');
        $formal = $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Formal', 'parent_id' => $shirts])->assertCreated()->json('data.id');
        $women = $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Women'])->assertCreated()->json('data.id');
        foreach (['Belt' => $men, 'Polo' => $shirts, 'Oxford' => $formal, 'Lawn Suit' => $women] as $name => $category) {
            $this->as($this->owner)->postJson('/api/v1/products', [
                'name' => $name, 'item_type' => 'physical_product', 'price' => 1000, 'category_id' => $category,
                'track_inventory' => true, 'stock_quantity' => 5,
            ])->assertCreated();
        }

        $listed = fn (string $category, string $extra = ''): array => collect($this->as($this->owner)
            ->getJson("/api/v1/products?category_id={$category}{$extra}")->assertOk()->json('data'))->pluck('name')->sort()->values()->all();

        $this->assertSame(['Belt', 'Oxford', 'Polo'], $listed($men), 'The parent found only what was filed under it by name.');
        $this->assertSame(['Oxford', 'Polo'], $listed($shirts));
        $this->assertSame(['Oxford'], $listed($formal), 'The exact category is still exact.');
        // The till asks the same door, for what can be sold.
        $this->assertSame(['Belt', 'Oxford', 'Polo'], $listed($men, '&for_sale=1&is_active=1'));

        // …and the export of the same screen.
        $csv = $this->as($this->owner)->get("/api/v1/products/export?category_id={$men}")->assertOk()->streamedContent();
        $this->assertStringContainsString('Oxford', $csv);
        $this->assertStringNotContainsString('Lawn Suit', $csv);
    }

    /** The user, 2026-10-21: staff without the permission can name only themselves as who served. */
    public function test_naming_a_colleague_as_who_served_needs_the_permission(): void
    {
        $this->as($this->owner)->putJson('/api/v1/shop/settings', ['pos_ask_who_served' => true])->assertOk();
        $this->product('Mug', 1000);
        $farhat = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create(['name' => 'Farhat']);
        $saira = User::factory()->tenantStaff($this->shop, ['sales.manage', 'sales.credit_others'])->create(['name' => 'Saira']);
        $sell = fn (User $who, ?string $servedBy): TestResponse => $this->as($who)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'card', 'amount_paid' => 1000, 'served_by' => $servedBy,
            'items' => [['product_id' => $this->item['Mug'], 'quantity' => 1]],
        ]);

        $sell($this->cashier, $farhat->id)->assertForbidden()->assertJsonPath('meta.error_code', 'SERVED_BY_NOT_YOURS');
        $this->assertSame($this->cashier->id, $sell($this->cashier, $this->cashier->id)->assertCreated()->json('data.served_by'));
        $sell($this->cashier, null)->assertCreated();

        // Who holds it — and the owner — may name anybody.
        $this->assertSame($farhat->id, $sell($saira, $farhat->id)->assertCreated()->json('data.served_by'));
        $this->assertSame($farhat->id, $sell($this->owner, $farhat->id)->assertCreated()->json('data.served_by'));
    }

    private function product(string $name, float $price, float $cost = 0, float $tax = 0): void
    {
        $this->item[$name] = $this->as($this->owner)->postJson('/api/v1/products', [
            'name' => $name, 'item_type' => 'physical_product', 'price' => $price, 'cost' => $cost,
            'tax_rate' => $tax, 'track_inventory' => true, 'stock_quantity' => 50,
        ])->assertCreated()->json('data.id');
    }

    private function as(User $user): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($user->createToken('t', ['access'])->plainTextToken);
    }
}
