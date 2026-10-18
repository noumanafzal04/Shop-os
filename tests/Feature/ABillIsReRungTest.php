<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Q19 B (the client, 2026-10-17): the bill is printed and the customer wants
 * it changed. The old bill is voided as re-rung, the new one rung, and what
 * was paid carries over — the same way it was paid — so only the difference
 * crosses the counter. One step: if the new bill cannot be rung, the old one
 * stands as it was. A plain bill, the same day, and a void's rule for who.
 */
class ABillIsReRungTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private User $cashier;

    private User $manager;

    /** @var array<string, string> */
    private array $item = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->travelTo(Carbon::parse('2026-10-17 15:00:00', 'Asia/Karachi'));

        $shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($shop)->create();
        $this->cashier = User::factory()->tenantStaff($shop, ['sales.manage'])->create(['name' => 'Ayesha']);
        $this->manager = User::factory()->tenantStaff($shop, ['sales.manage', 'sales.void'])->create(['name' => 'Hina']);
        $this->manager->setPin('1357');
        foreach (['Milk' => 100, 'Bread' => 150] as $name => $price) {
            $this->item[$name] = $this->as($this->owner)->postJson('/api/v1/products', [
                'name' => $name, 'item_type' => 'physical_product', 'price' => $price, 'track_inventory' => true, 'stock_quantity' => 50,
            ])->assertCreated()->json('data.id');
        }
        $this->as($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertSuccessful();
    }

    public function test_the_bill_is_replaced_and_only_the_difference_changes_hands(): void
    {
        $old = $this->sell(['Milk' => 8], ['payment_method' => 'cash', 'amount_paid' => 1000]);
        $this->assertEquals(200, $old['change_due']);
        $quote = $this->as($this->owner)->getJson("/api/v1/sales/{$old['id']}")->json('data.re_ring');
        $this->assertTrue($quote['open']);
        $this->assertEquals([['method' => 'cash', 'amount' => 800]], $quote['carried'], 'what was paid, net of the change');

        $new = $this->reRing($old, ['Milk' => 6, 'Bread' => 2], ['payment_method' => 'cash', 'amount_paid' => 100])->assertCreated()->json('data');

        $this->assertEquals(900, $new['total']);
        $this->assertEquals(0, $new['change_due']);
        $this->assertSame($old['invoice_number'], $new['replaces']['invoice_number']);
        $this->assertEqualsCanonicalizing(
            [['cash', 800, "Carried from {$old['invoice_number']}"], ['cash', 100, null]],
            collect($new['payments'])->map(fn ($p) => [$p['method'], (float) $p['amount'], $p['reference']])->all(),
        );
        $was = Sale::query()->findOrFail($old['id']);
        $this->assertSame('cancelled', $was->status->value);
        $this->assertSame('re_rung', $was->cancel_reason_code);
        $this->assertSame("Re-rung as {$new['invoice_number']}", $was->cancel_reason);
        // Six milk on the new bill: 50 − 8 + 8 − 6.
        $this->assertEquals(44, $this->stock('Milk'));
        $this->assertEquals(48, $this->stock('Bread'));

        // 1,000 float + the 800 kept from the old bill + the 100 difference.
        $this->assertEquals(1900, $this->drawer()['expected_cash']);
        $this->assertEquals(900, $this->as($this->owner)->getJson('/api/v1/dashboard')->json('data.today.revenue'), 'the old bill is not takings');
    }

    public function test_a_smaller_bill_hands_the_difference_back(): void
    {
        $old = $this->sell(['Milk' => 8], ['payment_method' => 'cash', 'amount_paid' => 800]);

        $new = $this->reRing($old, ['Milk' => 5], ['payment_method' => 'cash', 'amount_paid' => 0])->assertCreated()->json('data');

        $this->assertEquals(500, $new['total']);
        $this->assertEquals(300, $new['change_due'], 'handed back');
        $this->assertEquals(1500, $this->drawer()['expected_cash']);
    }

    public function test_a_card_bill_carries_as_card_and_may_not_shrink_into_cash(): void
    {
        $old = $this->sell(['Milk' => 8], ['payment_method' => 'card', 'amount_paid' => 800]);

        $new = $this->reRing($old, ['Milk' => 9], ['payment_method' => 'card', 'amount_paid' => 100])->assertCreated()->json('data');
        $this->assertEquals(900, $this->drawer()['tender_mix']['card'], 'the card machine took 800 and 100');
        $this->assertEquals(1000, $this->drawer()['expected_cash']);

        // Smaller on a card: there is no cash to hand the difference back from.
        $this->reRing(['id' => $new['id']], ['Milk' => 2], ['payment_method' => 'cash', 'amount_paid' => 0])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'CHANGE_WITHOUT_CASH');
        $this->assertSame('completed', Sale::query()->findOrFail($new['id'])->status->value, 'refused, and the bill stands as it was');
        $this->assertEquals(41, $this->stock('Milk'));
    }

    public function test_a_khata_bill_moves_its_debt_to_the_new_bill(): void
    {
        $old = $this->sell(['Milk' => 8], ['payment_method' => 'credit', 'amount_paid' => 800, 'customer_name' => 'Nasreen', 'customer_phone' => '03001110011']);
        $owes = fn () => (float) Customer::query()->where('phone', '03001110011')->value('credit_balance');
        $this->assertEquals(800, $owes());

        $this->reRing($old, ['Milk' => 9], ['payment_method' => 'credit', 'amount_paid' => 100])->assertCreated();

        $this->assertEquals(900, $owes(), 'she owes for the new bill, once');
    }

    public function test_only_a_plain_bill_on_its_own_day(): void
    {
        $this->travelTo(Carbon::parse('2026-10-16 15:00:00', 'Asia/Karachi'));
        $yesterday = $this->sell(['Milk' => 1]);
        $this->travelTo(Carbon::parse('2026-10-17 15:00:00', 'Asia/Karachi'));
        $this->reRing($yesterday, ['Milk' => 2])->assertStatus(409)->assertJsonPath('meta.error_code', 'SALE_DAY_OVER');

        $returned = $this->sell(['Milk' => 2], ['payment_method' => 'cash', 'amount_paid' => 200]);
        $this->as($this->owner)->postJson("/api/v1/sales/{$returned['id']}/returns", [
            'items' => [['sale_item_id' => $returned['items'][0]['id'], 'quantity' => 1]], 'refund_method' => 'cash', 'reason' => 'Wrong size',
        ])->assertSuccessful();
        $first = $this->sell(['Milk' => 1]);
        $this->sell(['Bread' => 1], ['adds_to_sale_id' => $first['id'], 'payment_method' => 'cash', 'amount_paid' => 150]);

        foreach ([$returned, $first] as $bill) {
            $this->assertFalse($this->as($this->owner)->getJson("/api/v1/sales/{$bill['id']}")->json('data.re_ring.open'));
            $this->reRing($bill, ['Milk' => 3])->assertStatus(409)->assertJsonPath('meta.error_code', 'RERING_NOT_PLAIN');
        }
        $this->assertStringContainsString('bills were added to it', $this->as($this->owner)->getJson("/api/v1/sales/{$first['id']}")->json('data.re_ring.why_not'));
    }

    public function test_a_re_rung_addition_stays_in_its_visit(): void
    {
        $first = $this->sell(['Milk' => 1]);
        $added = $this->sell(['Bread' => 1], ['adds_to_sale_id' => $first['id'], 'payment_method' => 'cash', 'amount_paid' => 150]);

        $new = $this->reRing($added, ['Bread' => 2], ['payment_method' => 'cash', 'amount_paid' => 150])->assertCreated()->json('data');

        $this->assertSame($first['id'], $new['adds_to_sale_id']);
        $this->assertEquals(400, $new['visit']['together'], 'the re-rung addition is named cancelled and not counted');
    }

    public function test_a_cashier_needs_a_pin_that_may_void(): void
    {
        $this->as($this->cashier)->postJson('/api/v1/pos/session/open', ['opening_float' => 500])->assertSuccessful();
        $old = $this->sell(['Milk' => 2], ['payment_method' => 'cash', 'amount_paid' => 200], $this->cashier);

        $this->reRing($old, ['Milk' => 3], ['payment_method' => 'cash', 'amount_paid' => 100], $this->cashier)
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'APPROVAL_REQUIRED');
        $this->assertSame('completed', Sale::query()->findOrFail($old['id'])->status->value);

        $this->reRing($old, ['Milk' => 3], [
            'payment_method' => 'cash', 'amount_paid' => 100, 'approval' => ['user_id' => $this->manager->id, 'pin' => '1357'],
        ], $this->cashier)->assertCreated();
    }

    /** @param array<string, int> $lines */
    private function sell(array $lines, array $extra = [], ?User $by = null): array
    {
        $total = collect($lines)->map(fn ($q, $name) => $q * ($name === 'Milk' ? 100 : 150))->sum();

        return $this->as($by ?? $this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => $total, 'items' => $this->items($lines), ...$extra,
        ])->assertCreated()->json('data');
    }

    /** @param array<string, int> $lines */
    private function reRing(array $old, array $lines, array $extra = [], ?User $by = null): TestResponse
    {
        return $this->as($by ?? $this->owner)->postJson("/api/v1/sales/{$old['id']}/re-ring", [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 0, 'items' => $this->items($lines), ...$extra,
        ]);
    }

    /** @param array<string, int> $lines */
    private function items(array $lines): array
    {
        return collect($lines)->map(fn ($q, $name) => ['product_id' => $this->item[$name], 'quantity' => $q])->values()->all();
    }

    private function stock(string $name): float
    {
        return (float) $this->as($this->owner)->getJson("/api/v1/products/{$this->item[$name]}")->json('data.stock_quantity');
    }

    private function drawer(): array
    {
        return $this->as($this->owner)->getJson('/api/v1/pos/session/report')->assertOk()->json('data.drawer');
    }

    private function as(User $user): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($user->createToken('t', ['access'])->plainTextToken);
    }
}
