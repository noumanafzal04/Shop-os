<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\DiningTable;
use App\Models\Product;
use App\Models\RestaurantTicket;
use App\Models\TaxGroup;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\TabBill;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * "BILL PLEASE" — and the paper says what the till will ask for.
 *
 * A waiter could answer that only by settling the tab: the one paper with a
 * total on it was the invoice, and an invoice is printed after the money has
 * changed hands. The tab screen's own total is an ESTIMATE of the tax, from
 * the shop's default rate.
 *
 * A printed bill is the amount a customer counts out, so `TabBill` is the
 * sale path's own rule for a tab, written once more. THIS is what holds the
 * two together: the same tab is billed, then settled, and the totals must be
 * the same number — across default rates, per-product rates, a tax group, an
 * exempt line, discounts and paid-for extras. If the sale path's arithmetic
 * ever changes and the bill's does not, this fails.
 */
class TheBillIsWhatTheTillWillAskForTest extends TestCase
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
            // Taxed at whatever the shop's default is.
            'karahi' => $dish('Chicken Karahi', 1890),
            // Its own rate, whatever the default.
            'tea' => $dish('Kashmiri Chai', 235, ['tax_rate' => 18]),
            // Exempt: nought is nought, not "use the default".
            'naan' => $dish('Roghni Naan', 55, ['tax_rate' => 0]),
            // In a tax group, which outranks its own rate.
            'cola' => $dish('Cola 1.5L', 249.99, ['tax_rate' => 5, 'tax_group_id' => $group->id]),
        ];
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function defaultRate(float $pct): void
    {
        $this->asOwner()->putJson('/api/v1/shop/settings', ['default_tax_rate' => $pct])->assertOk();
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

    private function billHtml(string $id): string
    {
        return (string) $this->asOwner()->get("/api/v1/restaurant/tickets/{$id}/bill")->assertOk()->getContent();
    }

    /** The figure printed beside TO PAY. */
    private function toPay(string $html): float
    {
        $this->assertSame(1, preg_match('/TO PAY<\/span><span>[^0-9]*([0-9,]+\.[0-9]{2})/', $html, $m), 'the bill has no TO PAY line');

        return (float) str_replace(',', '', $m[1]);
    }

    /** @return array<string, mixed> the sale the tab was settled into */
    private function settle(string $id, array $with = []): array
    {
        return $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$id}/settle", array_merge([
            'payment_method' => 'cash', 'amount_paid' => 999999,
        ], $with))->assertCreated()->json('data.sale');
    }

    public function test_the_bill_is_the_total_the_sale_then_charges_whatever_the_table_ate(): void
    {
        $tables = [
            'one dish at the default rate' => [['product_id' => $this->menu['karahi']->id, 'quantity' => 1]],
            'four rates at one table' => [
                ['product_id' => $this->menu['karahi']->id, 'quantity' => 2],
                ['product_id' => $this->menu['tea']->id, 'quantity' => 3],
                ['product_id' => $this->menu['naan']->id, 'quantity' => 7],
                ['product_id' => $this->menu['cola']->id, 'quantity' => 1],
            ],
            'an awkward price, three of it' => [['product_id' => $this->menu['cola']->id, 'quantity' => 3]],
            'a line with money off it' => [
                ['product_id' => $this->menu['karahi']->id, 'quantity' => 1, 'line_discount_pct' => 15],
                ['product_id' => $this->menu['tea']->id, 'quantity' => 2, 'line_discount' => 20],
            ],
            'only exempt food' => [['product_id' => $this->menu['naan']->id, 'quantity' => 12]],
        ];

        foreach ([0.0, 16.0, 7.5] as $default) {
            $this->defaultRate($default);

            foreach ($tables as $what => $items) {
                $id = $this->tab($items);
                $bill = TabBill::of(RestaurantTicket::withoutTenancy()->findOrFail($id), $default);
                $printed = $this->toPay($this->billHtml($id));

                $sale = $this->settle($id);

                $where = "{$what}, default rate {$default}%";
                $this->assertEquals((float) $sale['total'], $bill['total'], "the bill and the sale disagree on the total — {$where}");
                $this->assertEquals((float) $sale['tax'], $bill['tax'], "…and on the tax — {$where}");
                $this->assertEquals((float) $sale['subtotal'], $bill['subtotal'], "…and on the subtotal — {$where}");
                // And the paper carries that figure, not another.
                $this->assertEquals((float) $sale['total'], $printed, "the printed TO PAY is not what the till asked for — {$where}");
            }
        }
    }

    public function test_it_is_not_the_screens_estimate(): void
    {
        // The tab screen multiplies the subtotal by the shop's default rate.
        // Tea at 18%, naan at nought and a cola in a 13% group, at a shop
        // whose default is 16%, owe something else.
        $this->defaultRate(16);
        $id = $this->tab([
            ['product_id' => $this->menu['tea']->id, 'quantity' => 2],     // 470 @ 18% = 84.60
            ['product_id' => $this->menu['naan']->id, 'quantity' => 10],   // 550 @ 0
            ['product_id' => $this->menu['cola']->id, 'quantity' => 2],    // 499.98 @ 13% = 65.00
        ]);

        $bill = TabBill::of(RestaurantTicket::withoutTenancy()->findOrFail($id), 16);

        $this->assertEquals(1519.98, $bill['subtotal']);
        $this->assertEquals(149.60, $bill['tax']);
        $this->assertEquals(1669.58, $bill['total']);
        // What the screen would have shown: 1519.98 × 1.16.
        $this->assertNotEquals(round(1519.98 * 1.16, 2), $bill['total']);
    }

    public function test_a_table_that_split_is_billed_only_for_what_is_still_to_pay(): void
    {
        $this->defaultRate(16);
        $id = $this->tab([
            ['product_id' => $this->menu['karahi']->id, 'quantity' => 1],
            ['product_id' => $this->menu['tea']->id, 'quantity' => 2],
        ]);
        $ticket = RestaurantTicket::withoutTenancy()->findOrFail($id);
        $tea = $ticket->items()->where('product_id', $this->menu['tea']->id)->firstOrFail();

        // The two who had tea pay for it and leave.
        $this->settle($id, ['item_ids' => [$tea->id]]);

        $html = $this->billHtml($id);
        $this->assertStringContainsString('Chicken Karahi', $html);
        $this->assertStringNotContainsString('Kashmiri Chai', $html);
        // …and the paper says why the tea is not on it.
        $this->assertStringContainsString('1 item on this table was paid for earlier and is not on this bill.', $html);

        $rest = $this->settle($id);
        $this->assertEquals((float) $rest['total'], $this->toPay($html));
        $this->assertEquals(round(1890 * 1.16, 2), $this->toPay($html));
    }

    public function test_a_line_taken_off_the_tab_is_not_on_the_bill(): void
    {
        $id = $this->tab([
            ['product_id' => $this->menu['karahi']->id, 'quantity' => 1],
            ['product_id' => $this->menu['naan']->id, 'quantity' => 4],
        ]);
        $ticket = RestaurantTicket::withoutTenancy()->findOrFail($id);
        $naan = $ticket->items()->where('product_id', $this->menu['naan']->id)->firstOrFail();
        $this->asOwner()->deleteJson("/api/v1/restaurant/tickets/{$id}/items/{$naan->id}", ['reason' => 'Ordered by mistake'])->assertOk();

        $html = $this->billHtml($id);
        $this->assertStringNotContainsString('Roghni Naan', $html);
        $this->assertEquals(1890.0, $this->toPay($html));
        // A line that was taken off is not one that was "paid for earlier".
        $this->assertStringNotContainsString('paid for earlier', $html);
    }

    public function test_the_paper_says_whose_table_it_is_and_that_it_is_not_a_receipt(): void
    {
        $id = $this->tab([['product_id' => $this->menu['karahi']->id, 'quantity' => 2, 'note' => 'less oil']]);
        $number = RestaurantTicket::withoutTenancy()->findOrFail($id)->ticket_number;

        $html = $this->billHtml($id);

        foreach (['Karahi House', '042-1112223', 'BILL', 'Table 7', $number, 'Hamza', '2 × Chicken Karahi', 'Subtotal', 'TO PAY'] as $on) {
            $this->assertStringContainsString($on, $html, "the bill does not carry: {$on}");
        }
        // Twice: at the top, where it is picked up, and at the foot, where it is read last.
        $this->assertSame(2, preg_match_all('/NOT A RECEIPT/', $html));
        // Nothing that says money changed hands.
        foreach (['Invoice', 'Cash', 'Change', 'Paid', 'Cashier'] as $not) {
            $this->assertStringNotContainsString($not, strip_tags(preg_replace('/<style.*?<\/style>/s', '', $html)), "the bill reads like a receipt: {$not}");
        }
        // It does not print itself — the panel's one print door does.
        $this->assertStringNotContainsString('window.print', strip_tags($html, '<body>'));
    }

    public function test_a_takeaway_is_called_by_who_is_waiting_for_it(): void
    {
        $id = $this->asOwner()->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'takeaway', 'customer_name' => 'Mrs Qureshi',
        ])->assertCreated()->json('data.id');
        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$id}/items", [
            'items' => [['product_id' => $this->menu['naan']->id, 'quantity' => 6]],
        ])->assertOk();

        $html = $this->billHtml($id);

        $this->assertStringContainsString('Takeaway · Mrs Qureshi', $html);
        // No table, so the line is not called one.
        $this->assertStringNotContainsString('<span>Table</span>', $html);
        $this->assertStringContainsString('<span>Order</span>', $html);
    }

    public function test_it_is_drawn_for_the_shops_own_paper_and_money(): void
    {
        $this->asOwner()->putJson('/api/v1/shop/settings', ['receipt_width' => 'thermal_58', 'currency_symbol' => 'PKR'])->assertOk();
        $id = $this->tab([['product_id' => $this->menu['naan']->id, 'quantity' => 2]]);

        $html = $this->billHtml($id);

        $this->assertStringContainsString('PKR 110.00', $html);
        $this->assertStringContainsString('width: 58mm', $html);
        // No tax line for a table that owes none.
        $this->assertStringNotContainsString('>Tax<', $html);
    }

    public function test_a_tab_with_nothing_to_pay_and_a_tab_that_is_closed_have_no_bill(): void
    {
        $id = $this->tab([['product_id' => $this->menu['karahi']->id, 'quantity' => 1]]);
        $this->settle($id);

        // Closed: its invoice is the paper for that.
        $this->asOwner()->get("/api/v1/restaurant/tickets/{$id}/bill")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TICKET_NOT_OPEN');

        // Open, and everything on it was taken off.
        $empty = $this->tab([['product_id' => $this->menu['naan']->id, 'quantity' => 1]]);
        $line = RestaurantTicket::withoutTenancy()->findOrFail($empty)->items()->firstOrFail();
        $this->asOwner()->deleteJson("/api/v1/restaurant/tickets/{$empty}/items/{$line->id}", ['reason' => 'Mistake'])->assertOk();
        $this->asOwner()->get("/api/v1/restaurant/tickets/{$empty}/bill")
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'NOTHING_TO_BILL');
    }

    public function test_whoever_may_see_the_tab_may_print_its_bill_and_another_shop_may_not(): void
    {
        $id = $this->tab([['product_id' => $this->menu['karahi']->id, 'quantity' => 1]]);

        // A waiter whose table this is not: they may not work it, and may read it.
        $other = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create(['name' => 'Bilal']);
        $token = $other->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->get("/api/v1/restaurant/tickets/{$id}/bill")->assertOk();

        // Another restaurant altogether.
        $elsewhere = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'restaurant',
            'features' => BusinessTypes::defaultFeatures('restaurant'),
        ]);
        $stranger = User::factory()->shopOwner($elsewhere)->create();
        $token = $stranger->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->get("/api/v1/restaurant/tickets/{$id}/bill")->assertNotFound();
    }
}
