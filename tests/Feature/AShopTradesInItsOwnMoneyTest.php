<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Expense;
use App\Models\Plan;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Currencies;
use App\Support\DenominationCount;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A SHOP TRADES IN ITS OWN MONEY.
 *
 * The owner's words: "currency type add kro — agr Pakistan main use kry to usy
 * PKR chahye, USA main Dollar, India main INR — to wo select kr sky."
 *
 * A shop had a currency symbol it could not choose and a currency code nothing
 * read, and everything spoke rupees: the receipt, the messages, the notes a
 * drawer was counted in. One currency per shop, chosen from a list; nothing is
 * ever converted, which is why it is fixed once the business has traded.
 */
class AShopTradesInItsOwnMoneyTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true, 'timezone' => 'UTC']);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function settings(): array
    {
        return $this->as($this->owner)->getJson('/api/v1/shop/settings')->assertOk()->json('data');
    }

    private function choose(string $code): TestResponse
    {
        return $this->as($this->owner)->putJson('/api/v1/shop/settings', ['currency' => $code]);
    }

    private function sell(float $price = 2500, array $more = []): array
    {
        $item = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Kurta '.uniqid(), 'price' => $price, 'stock_quantity' => 50, 'track_inventory' => true,
        ]);

        return $this->as($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100000000,
            'items' => [['product_id' => $item->id, 'quantity' => 1]], ...$more,
        ])->assertCreated()->json('data');
    }

    private function receipt(array $sale): string
    {
        return (string) preg_replace('/\s+/', ' ', strip_tags($this->as($this->owner)
            ->get("/api/v1/sales/{$sale['id']}/invoice", ['Accept' => 'text/html'])->assertOk()->getContent()));
    }

    // ── which currency ──────────────────────────────────────────────────

    public function test_a_shop_that_never_chose_trades_in_rupees_as_it_always_did(): void
    {
        $s = $this->settings();

        $this->assertSame('PKR', $s['currency']);
        $this->assertSame('Rs', $s['currency_symbol']);
        $this->assertSame(
            ['code' => 'PKR', 'name' => 'Pakistani Rupee', 'symbol' => 'Rs', 'grouping' => 'western', 'decimals' => 'when_needed', 'space' => true, 'cash' => [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1]],
            $s['currency_format'],
        );
        $this->assertSame('Rs 4,000', $this->shop->money(4000));
        $this->assertSame('Rs 2,350,196.50', $this->shop->money(2350196.5));
    }

    public function test_it_chooses_dollars_and_the_mark_follows_the_code(): void
    {
        $this->choose('USD')->assertOk()
            ->assertJsonPath('data.currency', 'USD')
            ->assertJsonPath('data.currency_symbol', '$')
            ->assertJsonPath('data.currency_format.decimals', 'always');

        $this->assertSame('$4,000.00', $this->shop->fresh()->money(4000));
        $this->assertSame('-$5.00', $this->shop->fresh()->money(-5));
    }

    public function test_rupees_of_india_are_written_in_lakhs(): void
    {
        $this->choose('INR')->assertOk()->assertJsonPath('data.currency_symbol', '₹');

        $shop = $this->shop->fresh();
        $this->assertSame('₹12,34,567', $shop->money(1234567));
        $this->assertSame('₹1,00,000', $shop->money(100000));
        $this->assertSame('₹999.50', $shop->money(999.5));
    }

    public function test_the_mark_is_read_from_the_code_and_a_stale_one_beside_it_is_not_believed(): void
    {
        // What a shop's settings could hold before: any three letters, and a
        // mark of the caller's choosing beside them.
        $this->shop->forceFill(['settings' => ['currency' => 'USD', 'currency_symbol' => 'Rs']])->save();

        $this->assertSame('$', $this->settings()['currency_symbol']);
        $this->assertSame('$1.00', $this->shop->fresh()->money(1));

        // …and a mark sent on its own is no longer a setting at all.
        $this->as($this->owner)->putJson('/api/v1/shop/settings', ['currency_symbol' => '£'])->assertOk()
            ->assertJsonPath('data.currency_symbol', '$');
        $this->assertArrayNotHasKey('currency_symbol', $this->shop->fresh()->settings);
    }

    public function test_only_a_currency_the_product_can_write_may_be_chosen(): void
    {
        $this->choose('XYZ')->assertStatus(422);
        $this->choose('rupees')->assertStatus(422);
        $this->assertSame('PKR', $this->shop->fresh()->currency());

        // A code the list does not hold, already on a shop, reads as the default — never as a bare word.
        $this->shop->forceFill(['settings' => ['currency' => 'XYZ']])->save();
        $this->assertSame('PKR', $this->settings()['currency']);
    }

    // ── fixed once the business has traded ──────────────────────────────

    public function test_it_may_be_changed_freely_until_there_is_money_on_the_books(): void
    {
        $asked = $this->as($this->owner)->getJson('/api/v1/shop/currencies')->assertOk()->json('data');

        $this->assertFalse($asked['locked']);
        $this->assertNull($asked['why']);
        $this->assertSame(Currencies::codes(), array_column($asked['options'], 'code'));
        $this->assertContains('PKR', Currencies::codes());
        $this->assertContains('USD', Currencies::codes());
        $this->assertContains('INR', Currencies::codes());

        $this->choose('USD')->assertOk();
        $this->choose('INR')->assertOk();
        $this->choose('PKR')->assertOk();
    }

    public function test_after_the_first_sale_it_is_fixed_and_says_why(): void
    {
        $this->sell();

        $this->choose('USD')
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'CURRENCY_LOCKED')
            ->assertJsonPath('message', fn (string $m) => str_contains($m, 'Pakistani Rupee (PKR)') && str_contains($m, 'converts nothing'));
        $this->assertSame('PKR', $this->shop->fresh()->currency());

        $asked = $this->as($this->owner)->getJson('/api/v1/shop/currencies')->assertOk()->json('data');
        $this->assertTrue($asked['locked']);
        $this->assertStringContainsString('fixed once trading has begun', $asked['why']);
        $this->assertSame('PKR', $asked['current']['code']);
    }

    public function test_saving_the_rest_of_the_settings_with_the_same_currency_is_not_a_change(): void
    {
        $this->sell();

        // The settings screen sends everything it holds.
        $this->as($this->owner)->putJson('/api/v1/shop/settings', ['currency' => 'PKR', 'default_tax_rate' => 5])
            ->assertOk()->assertJsonPath('data.default_tax_rate', 5);
    }

    public function test_an_office_that_only_keeps_books_is_fixed_by_its_first_expense(): void
    {
        // No sale, no order — only a bill that was paid. That is money on the books too.
        Expense::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'description' => 'Rent', 'amount' => 50000,
            'expense_date' => now()->toDateString(), 'payment_method' => 'bank_transfer',
        ]);

        $this->choose('USD')->assertStatus(409)->assertJsonPath('meta.error_code', 'CURRENCY_LOCKED');
    }

    // ── what is written in it ───────────────────────────────────────────

    public function test_the_receipt_is_in_the_shops_money(): void
    {
        $this->choose('USD')->assertOk();
        $paper = $this->receipt($this->sell(2500));

        $this->assertStringContainsString('$2,500.00', $paper);
        $this->assertStringNotContainsString('Rs', $paper);
    }

    public function test_an_indian_receipt_has_its_commas_where_india_puts_them(): void
    {
        $this->choose('INR')->assertOk();
        $paper = $this->receipt($this->sell(123456));

        $this->assertStringContainsString('₹1,23,456.00', $paper);
        $this->assertStringNotContainsString('123,456', $paper);
    }

    public function test_a_rupee_receipt_reads_exactly_as_it_did(): void
    {
        $paper = $this->receipt($this->sell(123456));

        $this->assertStringContainsString('Rs 123,456.00', $paper);
    }

    // ── the drawer ──────────────────────────────────────────────────────

    public function test_a_dollar_drawer_is_counted_in_dollars_and_cents(): void
    {
        $this->choose('USD')->assertOk();
        $this->as($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 100])->assertCreated();

        $report = $this->as($this->owner)->getJson('/api/v1/pos/session/report')->assertOk()->json('data');
        $this->assertSame([100, 50, 20, 10, 5, 2, 1, 0.25, 0.1, 0.05, 0.01], $report['denominations']);

        // One hundred, three quarters, two cents — and a five-thousand-rupee
        // note, which a dollar drawer cannot hold and is not counted.
        $closed = $this->as($this->owner)->postJson('/api/v1/pos/session/close', [
            'counted_cash' => 0,
            'denominations' => ['100' => 1, '0.25' => 3, '0.01' => 2, '5000' => 4],
        ])->assertOk()->json('data');

        $this->assertEquals(100.77, $closed['counted_cash']);
        $this->assertSame(['100' => 1, '0.25' => 3, '0.01' => 2], $closed['closing_denominations']);
    }

    public function test_a_rupee_drawer_is_counted_as_it_always_was(): void
    {
        $this->assertSame(DenominationCount::PKR, DenominationCount::for('PKR'));
        $this->assertSame(DenominationCount::PKR, DenominationCount::for(null));
        $this->assertEquals(12500.0, DenominationCount::total(['5000' => 2, '1000' => 2, '500' => 1], DenominationCount::for('PKR')));
        // The same coin said three ways is one coin.
        $this->assertSame(['0.25' => 6], DenominationCount::clean(['0.25' => 1, '0.250' => 2, '.25' => 3], DenominationCount::for('USD')));
    }

    // ── where it is chosen, and who is told ─────────────────────────────

    public function test_the_admin_creates_a_business_in_the_currency_it_names(): void
    {
        $admin = User::factory()->superAdmin()->create();
        $plan = Plan::query()->create(['name' => 'Basic', 'code' => 'basic-'.uniqid(), 'price' => 3000, 'billing_period' => 'monthly', 'is_active' => true]);

        $made = $this->as($admin)->postJson('/api/v1/admin/tenants', [
            'business_name' => 'Delhi Kirana '.uniqid(), 'business_type' => 'mart', 'plan_id' => $plan->id, 'currency' => 'INR',
            'owner' => ['name' => 'Ravi', 'email' => 'ravi-'.uniqid().'@shop.test', 'password' => 'password123'],
        ])->assertCreated()->json('data');

        $this->assertSame('INR', Tenant::query()->findOrFail($made['id'])->currency());
        // The admin's own page is told, so it can write this shop's figures in its money.
        $this->as($admin)->getJson("/api/v1/admin/tenants/{$made['id']}")->assertOk()
            ->assertJsonPath('data.currency.code', 'INR')
            ->assertJsonPath('data.currency.symbol', '₹');

        $this->as($admin)->postJson('/api/v1/admin/tenants', [
            'business_name' => 'Nowhere '.uniqid(), 'business_type' => 'mart', 'plan_id' => $plan->id, 'currency' => 'XYZ',
            'owner' => ['name' => 'X', 'email' => 'x-'.uniqid().'@shop.test', 'password' => 'password123'],
        ])->assertStatus(422);
    }

    public function test_the_owner_may_name_it_at_setup_and_a_business_that_has_traded_keeps_its_own(): void
    {
        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $setup = ['business_name' => $this->shop->business_name, 'city_id' => $city->id];

        $this->as($this->owner)->putJson('/api/v1/shop/setup', $setup + ['currency' => 'USD'])->assertOk();
        $this->assertSame('USD', $this->shop->fresh()->currency());

        $this->sell();
        $this->as($this->owner)->putJson('/api/v1/shop/setup', $setup + ['currency' => 'INR'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'CURRENCY_LOCKED');
        $this->assertSame('USD', $this->shop->fresh()->currency());
    }

    public function test_the_till_and_the_shop_front_are_told_the_currency(): void
    {
        $this->choose('USD')->assertOk();

        // The till prices and prints with what its catalogue pull carries — online and off.
        $this->as($this->owner)->getJson('/api/v1/pos/bootstrap')->assertOk()
            ->assertJsonPath('data.settings.currency', 'USD')
            ->assertJsonPath('data.settings.currency_format.symbol', '$');

        // A customer reading this shop's prices is told what they are in.
        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop->forceFill(['city_id' => $city->id, 'online_shop_enabled' => true])->save();
        $this->getJson("/api/v1/marketplace/shops/{$this->shop->slug}")->assertOk()
            ->assertJsonPath('data.currency.code', 'USD')
            ->assertJsonPath('data.currency.symbol', '$');
    }
}
