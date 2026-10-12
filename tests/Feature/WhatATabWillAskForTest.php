<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\DiningTable;
use App\Models\Product;
use App\Models\RestaurantTicket;
use App\Models\RestaurantTicketItem;
use App\Models\Sale;
use App\Models\TaxGroup;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE SETTLE SHEET SAYS WHAT THE TILL WILL TAKE.
 *
 *     "Take Rs 4,485" — pressed — "Amount paid (4,485.00) is less than the
 *      total (4,611.90)."
 *
 * The sheet a waiter settles a tab on added the bill up itself, at the shop's
 * default rate, and sent that figure as the money handed over. A table with
 * tea at its own 18% owed more than the sheet said, so the till refused the
 * payment and the tab could not be settled from the screen.
 *
 * Nothing caught it because every test that settled a tab paid 999,999 — a
 * payment no bill refuses. These pay EXACTLY what the sheet is told, and the
 * sheet is told by the path that charges it (`SettleTicketAction::worth`).
 */
class WhatATabWillAskForTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private DiningTable $table;

    /** @var array<string, Product> */
    private array $menu = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'business_name' => 'Karahi House', 'phone' => '042-1112223',
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'restaurant',
            'features' => BusinessTypes::defaultFeatures('restaurant'),
            'timezone' => 'Asia/Karachi',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create(['name' => 'Hamza']);
        $this->table = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Table 7', 'area' => 'Hall', 'seats' => 4,
        ]);

        $group = TaxGroup::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Drinks', 'rate' => 13, 'is_active' => true,
        ]);
        $dish = fn (string $name, float $price, array $more = []) => Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => $name, 'price' => $price, 'cost' => 1,
            'track_inventory' => false, 'is_active' => true,
        ], $more));

        $this->menu = [
            'karahi' => $dish('Chicken Karahi', 1890),                       // the shop's default rate
            'tea' => $dish('Kashmiri Chai', 235, ['tax_rate' => 18]),        // its own
            'naan' => $dish('Roghni Naan', 55, ['tax_rate' => 0]),           // exempt
            'cola' => $dish('Cola 1.5L', 249.99, ['tax_rate' => 5, 'tax_group_id' => $group->id]), // a group's
        ];
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function shopSetting(array $what): void
    {
        $this->asOwner()->putJson('/api/v1/shop/settings', $what)->assertOk();
    }

    /** @param  array<int, array<string, mixed>>  $items */
    private function tab(array $items): string
    {
        $id = $this->asOwner()->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in', 'dining_table_id' => $this->table->id, 'guest_count' => 3,
        ])->assertCreated()->json('data.id');
        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$id}/items", ['items' => $items])->assertOk();

        return $id;
    }

    /** @return array<string, float> what the sheet is told */
    private function worth(string $id, array $ask = []): array
    {
        return $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$id}/settle/worth", $ask + ['methods' => ['cash']])
            ->assertOk()->json('data');
    }

    /** @return list<array{id: string, quantity: float}> every unpaid line, whole */
    private function everyLine(string $id): array
    {
        return RestaurantTicketItem::withoutTenancy()->where('ticket_id', $id)->whereNull('voided_at')->whereNull('sale_id')
            ->orderBy('created_at')->orderBy('id')->get()
            ->map(fn (RestaurantTicketItem $i) => ['id' => $i->id, 'quantity' => (float) $i->quantity])
            // Never an empty list: "no splits" means the whole tab, and a
            // helper that found nothing would pass for the wrong reason.
            ->whenEmpty(fn () => $this->fail('the tab has no unpaid line to settle'))
            ->all();
    }

    /** What is on the tab, as it would look if anything had been written to it. */
    private function snapshot(string $id): array
    {
        return RestaurantTicketItem::withoutTenancy()->where('ticket_id', $id)->orderBy('id')->get()
            ->map(fn (RestaurantTicketItem $i) => [$i->id, (float) $i->quantity, (float) $i->line_total, (float) $i->line_discount, $i->sale_id])->all();
    }

    public function test_paying_exactly_what_the_sheet_says_settles_the_tab_whatever_each_dish_is_taxed_at(): void
    {
        $tables = [
            'the table from the report: karahi and tea' => [
                ['product_id' => $this->menu['karahi']->id, 'quantity' => 2],
                ['product_id' => $this->menu['tea']->id, 'quantity' => 3],
            ],
            'four rates at one table' => [
                ['product_id' => $this->menu['karahi']->id, 'quantity' => 2],
                ['product_id' => $this->menu['tea']->id, 'quantity' => 3],
                ['product_id' => $this->menu['naan']->id, 'quantity' => 7],
                ['product_id' => $this->menu['cola']->id, 'quantity' => 1],
            ],
            'a line with money off it' => [
                ['product_id' => $this->menu['karahi']->id, 'quantity' => 1, 'line_discount_pct' => 15],
                ['product_id' => $this->menu['tea']->id, 'quantity' => 2, 'line_discount' => 20],
            ],
            'only exempt food' => [['product_id' => $this->menu['naan']->id, 'quantity' => 12]],
        ];

        foreach ([0.0, 16.0, 7.5] as $default) {
            $this->shopSetting(['default_tax_rate' => $default]);

            foreach ($tables as $what => $items) {
                $where = "{$what}, default rate {$default}%";
                $id = $this->tab($items);
                $splits = $this->everyLine($id);
                $said = $this->worth($id, ['splits' => $splits]);

                // The cash handed over is the figure on the button — not a paisa more.
                $paid = $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$id}/settle", [
                    'splits' => $splits, 'payment_method' => 'cash', 'amount_paid' => $said['due'],
                ]);
                $paid->assertCreated();

                $this->assertEquals((float) $paid->json('data.sale.total'), $said['total'], "the sheet and the sale disagree on the bill — {$where}");
                $this->assertEquals((float) $paid->json('data.sale.tax'), $said['tax'], "…and on the tax — {$where}");
                $this->assertEquals((float) $paid->json('data.sale.subtotal'), $said['subtotal'], "…and on the subtotal — {$where}");
                $this->assertEquals(0.0, (float) $paid->json('data.sale.change_due'), "paying the sheet's figure left change — {$where}");
                $this->assertSame('closed', $paid->json('data.ticket.status'), "the tab did not close — {$where}");
            }
        }
    }

    public function test_the_table_from_the_report_is_told_4611_90_and_not_4485(): void
    {
        // No default rate at all, as in the shop it was found in: the sheet
        // multiplied by nought and the tea's own 18% was nowhere.
        $id = $this->tab([
            ['product_id' => $this->menu['karahi']->id, 'quantity' => 2],  // 3,780 @ 0
            ['product_id' => $this->menu['tea']->id, 'quantity' => 3],     //   705 @ 18% = 126.90
        ]);

        $said = $this->worth($id);

        $this->assertEquals(4485.00, $said['subtotal']);
        $this->assertEquals(126.90, $said['tax']);
        $this->assertEquals(4611.90, $said['total']);
        $this->assertEquals(4611.90, $said['due']);
    }

    public function test_asking_writes_nothing_and_takes_no_number(): void
    {
        $this->shopSetting(['default_tax_rate' => 16]);
        $id = $this->tab([
            ['product_id' => $this->menu['karahi']->id, 'quantity' => 2],
            ['product_id' => $this->menu['tea']->id, 'quantity' => 3],
        ]);
        $before = $this->snapshot($id);
        $lines = $this->everyLine($id);

        // Asked about the whole tab, and about PART of a line — which the
        // settlement answers by carving that line in two.
        $this->worth($id);
        $this->worth($id, ['splits' => [['id' => $lines[0]['id'], 'quantity' => 1]]]);
        $this->worth($id, ['splits' => [['id' => $lines[1]['id'], 'quantity' => 2]], 'tip_amount' => 50]);

        $this->assertSame($before, $this->snapshot($id), 'asking what a tab comes to changed the tab');
        $this->assertSame(0, Sale::withoutTenancy()->where('tenant_id', $this->shop->id)->count(), 'asking rang a sale');
        $this->assertSame('open', RestaurantTicket::withoutTenancy()->findOrFail($id)->status->value);

        // …and the first sale really rung is still the shop's first.
        $sale = $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$id}/settle", ['payment_method' => 'card', 'amount_paid' => $this->worth($id, ['methods' => ['card']])['due']])
            ->assertCreated()->json('data.sale');
        $this->assertSame(1, Sale::withoutTenancy()->where('tenant_id', $this->shop->id)->count());
        $this->assertStringEndsWith('000001', (string) $sale['invoice_number'], 'a question took an invoice number');
    }

    public function test_part_of_a_line_is_worth_what_settling_that_part_charges(): void
    {
        $this->shopSetting(['default_tax_rate' => 16]);
        $id = $this->tab([
            ['product_id' => $this->menu['karahi']->id, 'quantity' => 3, 'line_discount' => 100],
            ['product_id' => $this->menu['tea']->id, 'quantity' => 3],
            ['product_id' => $this->menu['cola']->id, 'quantity' => 3],
        ]);
        $lines = $this->everyLine($id);
        // One of the three karahi, two of the three teas, none of the cola.
        $part = [['id' => $lines[0]['id'], 'quantity' => 1], ['id' => $lines[1]['id'], 'quantity' => 2]];

        $said = $this->worth($id, ['splits' => $part]);
        $paid = $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$id}/settle", [
            'splits' => $part, 'payment_method' => 'cash', 'amount_paid' => $said['due'],
        ])->assertCreated();

        $this->assertEquals((float) $paid->json('data.sale.total'), $said['total']);
        $this->assertEquals(0.0, (float) $paid->json('data.sale.change_due'));
        $this->assertSame('open', $paid->json('data.ticket.status'), 'part of the tab closed the whole of it');

        // What is left is told as what is left, and paying that closes it.
        $rest = $this->worth($id);
        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$id}/settle", ['payment_method' => 'cash', 'amount_paid' => $rest['due']])
            ->assertCreated()->assertJsonPath('data.ticket.status', 'closed')->assertJsonPath('data.sale.change_due', fn ($change) => (float) $change === 0.0);
    }

    public function test_a_cash_bill_settles_to_the_shops_coin_and_a_card_bill_does_not(): void
    {
        $this->shopSetting(['default_tax_rate' => 16, 'cash_rounding' => 5]);
        // 705 + 18% = 831.90 — which is not a multiple of five rupees.
        $id = $this->tab([['product_id' => $this->menu['tea']->id, 'quantity' => 3]]);

        $cash = $this->worth($id, ['methods' => ['cash']]);
        $card = $this->worth($id, ['methods' => ['card']]);
        $both = $this->worth($id, ['methods' => ['cash', 'card']]);

        $this->assertEquals(831.90, $cash['total']);
        $this->assertEquals(830.00, $cash['due'], 'a cash bill was not settled to the coin');
        $this->assertEquals(-1.90, $cash['rounding']);
        $this->assertEquals(831.90, $card['due'], 'a card bill was rounded to a coin');
        $this->assertEquals(0.0, $card['rounding']);
        $this->assertEquals(831.90, $both['due'], 'a bill only partly in cash was rounded to a coin');

        // And 830 in cash is taken, with nothing back.
        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$id}/settle", ['payment_method' => 'cash', 'amount_paid' => $cash['due']])
            ->assertCreated()->assertJsonPath('data.ticket.status', 'closed')->assertJsonPath('data.sale.change_due', fn ($change) => (float) $change === 0.0);
    }

    public function test_a_tip_is_on_what_is_handed_over_and_not_on_the_bill(): void
    {
        $this->shopSetting(['default_tax_rate' => 16, 'tips_enabled' => true]);
        $id = $this->tab([['product_id' => $this->menu['karahi']->id, 'quantity' => 1]]);

        $plain = $this->worth($id);
        $tipped = $this->worth($id, ['tip_amount' => 200]);

        $this->assertEquals($plain['total'], $tipped['total'], 'the tip was put on the bill');
        $this->assertEquals(200.0, $tipped['tip']);
        $this->assertEquals(round($plain['due'] + 200, 2), $tipped['due']);

        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$id}/settle", ['payment_method' => 'cash', 'amount_paid' => $tipped['due'], 'tip_amount' => 200])
            ->assertCreated()->assertJsonPath('data.ticket.status', 'closed')->assertJsonPath('data.sale.change_due', fn ($change) => (float) $change === 0.0);
    }

    public function test_a_tab_that_is_closed_or_empty_is_refused_in_words(): void
    {
        $id = $this->tab([['product_id' => $this->menu['naan']->id, 'quantity' => 1]]);
        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$id}/settle", ['payment_method' => 'cash', 'amount_paid' => 55])->assertCreated();

        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$id}/settle/worth", ['methods' => ['cash']])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TICKET_NOT_OPEN');
        // How it will be paid has to be said: the coin depends on it.
        $open = $this->tab([['product_id' => $this->menu['naan']->id, 'quantity' => 1]]);
        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$open}/settle/worth", [])->assertStatus(422);
    }

    public function test_only_somebody_who_may_take_the_money_may_ask_what_it_is(): void
    {
        $id = $this->tab([['product_id' => $this->menu['naan']->id, 'quantity' => 1]]);
        $cook = User::factory()->create(['tenant_id' => $this->shop->id, 'role' => 'staff', 'permissions' => ['kitchen.view']]);
        $token = $cook->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->postJson("/api/v1/restaurant/tickets/{$id}/settle/worth", ['methods' => ['cash']])->assertStatus(403);
    }

    public function test_a_client_cannot_tell_a_settlement_to_stop_short(): void
    {
        // `quote_only` is our own switch. Sent from outside it is not in the
        // request's rules, so it never reaches the sale: the tab is settled.
        $id = $this->tab([['product_id' => $this->menu['naan']->id, 'quantity' => 2]]);

        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$id}/settle", ['payment_method' => 'cash', 'amount_paid' => 110, 'quote_only' => true])
            ->assertCreated()->assertJsonPath('data.ticket.status', 'closed');
        $this->assertSame(1, Sale::withoutTenancy()->where('tenant_id', $this->shop->id)->count());
    }
}
