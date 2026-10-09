<?php

namespace Tests\Unit;

use App\Models\Plan;
use App\Models\Tenant;
use App\Support\ModulePackages;
use App\Support\Modules;
use App\Support\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Which modules a shop is offered — by its trade, and by its plan.
 *
 * The rules are small and the consequences are not: a module left off a
 * trade's list is one an admin cannot find, and a module wrongly "in the plan"
 * is one a small shop is given without anybody choosing it.
 */
class ModulePackagesTest extends TestCase
{
    use RefreshDatabase;

    private const TRADES = ['food', 'mart', 'pharmacy', 'retail', 'services', 'automotive', 'petroleum', 'online', 'finance'];

    /** @return array<string, array{0: string}> */
    public static function trades(): array
    {
        return array_combine(self::TRADES, array_map(fn (string $t) => [$t], self::TRADES));
    }

    private function plan(string $code, ?array $modules = null): Plan
    {
        return new Plan(['code' => $code, 'name' => ucfirst($code), 'modules' => $modules]);
    }

    private function on(array $map): array
    {
        return array_keys(array_filter($map));
    }

    // ── the trade ─────────────────────────────────────────────────────

    #[DataProvider('trades')]
    public function test_nothing_a_trade_is_given_by_default_is_hidden_from_it(string $trade): void
    {
        $this->assertSame(
            [],
            array_values(array_diff($this->on(Modules::defaultsFor($trade)), ModulePackages::eligibleFor($trade))),
            "a new {$trade} shop is switched on for something its own screen would not offer",
        );
    }

    #[DataProvider('trades')]
    public function test_what_a_trade_cannot_open_without_is_something_it_can_use_with_all_it_depends_on(string $trade): void
    {
        $essential = ModulePackages::essentialFor($trade);
        $this->assertNotEmpty($essential);

        $withDependencies = $this->on(Modules::settle([], array_fill_keys($essential, true)));
        $this->assertSame([], array_values(array_diff($withDependencies, ModulePackages::eligibleFor($trade))));
    }

    #[DataProvider('trades')]
    public function test_whatever_a_trade_can_use_it_can_also_use_what_that_depends_on(string $trade): void
    {
        // A list that offered Labels and not Inventory would offer a switch
        // that drags in something the screen says is not for this trade.
        $eligible = ModulePackages::eligibleFor($trade);
        $closed = $this->on(Modules::settle([], array_fill_keys($eligible, true)));

        $this->assertSame([], array_values(array_diff($closed, $eligible)));
    }

    #[DataProvider('trades')]
    public function test_every_module_is_in_exactly_one_of_the_three_lists(string $trade): void
    {
        foreach (['basic', 'premium', 'pro', 'enterprise'] as $code) {
            $offer = ModulePackages::propose($trade, $this->plan($code));
            $all = [...$offer['included'], ...$offer['addons'], ...$offer['other']];

            $this->assertEqualsCanonicalizing(Modules::keys(), $all, "{$trade} on {$code}");
            $this->assertSame(count($all), count(array_unique($all)), "{$trade} on {$code} lists a module twice");
            // What is proposed is what a save would store.
            $this->assertEqualsCanonicalizing($offer['included'], $this->on($offer['modules']));
        }
    }

    public function test_a_trade_is_not_offered_another_trades_machinery(): void
    {
        $this->assertNotContains('kitchen', ModulePackages::eligibleFor('pharmacy'));
        $this->assertNotContains('dine_in', ModulePackages::eligibleFor('mart'));
        $this->assertNotContains('fuel', ModulePackages::eligibleFor('food'));
        $this->assertContains('fuel', ModulePackages::eligibleFor('petroleum'));
        $this->assertSame(['expenses', 'hrm'], ModulePackages::eligibleFor('finance'));
    }

    public function test_an_older_name_for_a_trade_answers_as_the_trade(): void
    {
        $this->assertSame(ModulePackages::eligibleFor('food'), ModulePackages::eligibleFor('restaurant'));
        $this->assertSame(
            ModulePackages::propose('food', $this->plan('basic')),
            ModulePackages::propose('restaurant', $this->plan('basic')),
        );
    }

    public function test_a_trade_nobody_has_described_is_offered_everything_rather_than_nothing(): void
    {
        $this->assertSame(Modules::keys(), ModulePackages::eligibleFor('a-trade-from-next-year'));
    }

    // ── the plan ──────────────────────────────────────────────────────

    public function test_basic_is_the_small_shop_products_labels_and_a_till(): void
    {
        $offer = ModulePackages::propose('mart', $this->plan('basic'));

        // Labels cannot print without a shelf to read, so Inventory comes with it.
        $this->assertSame(['products', 'pos', 'inventory', 'labels'], $offer['included']);
        foreach (['customers', 'expenses', 'purchasing', 'marketplace', 'promotions'] as $extra) {
            $this->assertContains($extra, $offer['addons'], "{$extra} should be an add-on for a small mart");
        }
        foreach (['kitchen', 'dine_in', 'fuel', 'services'] as $foreign) {
            $this->assertContains($foreign, $offer['other']);
        }
    }

    public function test_a_restaurant_on_basic_still_has_its_kitchen_and_is_not_handed_a_stock_room(): void
    {
        $offer = ModulePackages::propose('food', $this->plan('basic'));

        $this->assertSame(['products', 'pos', 'kitchen'], $offer['included']);
        $this->assertContains('dine_in', $offer['addons']);
        $this->assertContains('inventory', $offer['addons']);
    }

    public function test_a_filling_station_on_basic_has_its_tanks_and_an_office_its_books(): void
    {
        $this->assertSame(['products', 'services', 'pos', 'inventory', 'fuel'], ModulePackages::propose('petroleum', $this->plan('basic'))['included']);

        $office = ModulePackages::propose('finance', $this->plan('basic'));
        $this->assertSame(['expenses'], $office['included']);
        $this->assertSame(['hrm'], $office['addons']);
    }

    #[DataProvider('trades')]
    public function test_each_rung_of_the_ladder_holds_all_of_the_one_below_it(string $trade): void
    {
        $rungs = array_map(
            fn (string $code) => ModulePackages::propose($trade, $this->plan($code))['included'],
            ['basic', 'premium', 'pro', 'enterprise'],
        );

        foreach ([1, 2, 3] as $i) {
            $this->assertSame(
                [],
                array_values(array_diff($rungs[$i - 1], $rungs[$i])),
                "a {$trade} shop that moves up a plan loses something it had",
            );
        }
        // And the top one is the whole of what the trade can use.
        $this->assertSame(ModulePackages::eligibleFor($trade), $rungs[3]);
    }

    public function test_pro_is_the_shop_that_sells_past_its_counter(): void
    {
        $standard = ModulePackages::propose('mart', $this->plan('premium'));
        $pro = ModulePackages::propose('mart', $this->plan('pro'));

        foreach (['marketplace', 'delivery', 'promotions'] as $online) {
            $this->assertContains($online, $standard['addons'], "{$online} is an add-on on Standard");
            $this->assertContains($online, $pro['included'], "{$online} comes with Pro");
        }
    }

    public function test_premium_adds_the_books_and_enterprise_is_everything_the_trade_can_use(): void
    {
        $basic = ModulePackages::propose('mart', $this->plan('basic'))['included'];
        $premium = ModulePackages::propose('mart', $this->plan('premium'))['included'];

        $this->assertSame([], array_values(array_diff($basic, $premium)), 'Premium dropped something Basic has');
        foreach (['customers', 'purchasing', 'stocktake', 'expenses'] as $books) {
            $this->assertContains($books, $premium);
        }
        // Still chosen shop by shop, even on Premium.
        $this->assertContains('marketplace', ModulePackages::propose('mart', $this->plan('premium'))['addons']);

        $everything = ModulePackages::propose('pharmacy', $this->plan('enterprise'));
        $this->assertSame(ModulePackages::eligibleFor('pharmacy'), $everything['included']);
        $this->assertSame([], $everything['addons']);
    }

    public function test_a_plan_with_a_list_of_its_own_is_obeyed_and_the_trade_is_still_honoured(): void
    {
        $own = $this->plan('basic', ['customers', 'dine_in', 'not-a-module']);

        // The trade's essentials, the plan's customers — and no dining room
        // for a mart, however the plan was written.
        $this->assertSame(['products', 'pos', 'customers'], ModulePackages::propose('mart', $own)['included']);
        $this->assertSame(['customers', 'dine_in'], ModulePackages::ofPlan($own));

        // A plan that includes nothing is still a plan: the list is empty, not absent.
        $this->assertSame(['products', 'pos'], ModulePackages::propose('mart', $this->plan('basic', []))['included']);
    }

    public function test_a_bespoke_plan_nobody_described_starts_from_premium(): void
    {
        $this->assertSame(
            ModulePackages::propose('retail', $this->plan('premium'))['included'],
            ModulePackages::propose('retail', $this->plan('al-noor-custom'))['included'],
        );
        $this->assertSame(
            ModulePackages::propose('retail', $this->plan('premium'))['included'],
            ModulePackages::propose('retail', null)['included'],
        );
    }

    // ── a shop against its plan ───────────────────────────────────────

    public function test_what_a_shop_has_is_told_apart_as_the_plans_and_its_own(): void
    {
        $standing = ModulePackages::standing('mart', $this->plan('basic'), [
            'products' => true, 'pos' => true, 'inventory' => true, 'labels' => false,
            'customers' => true, 'kitchen' => true, 'something_else' => true,
        ]);

        $this->assertSame(['products', 'pos', 'inventory'], $standing['included']);
        // Customers was added for this shop — and so was the kitchen, which its
        // trade is not even offered: it is on, so it is said.
        $this->assertSame(['customers', 'kitchen'], $standing['addons']);
        // In the plan, and switched off here.
        $this->assertSame(['labels'], $standing['missing']);
    }

    // ── what it comes to ──────────────────────────────────────────────

    private function shop(string $trade, string $plan, array $modules, array $own = [], int $months = 1, float $price = 2499): Tenant
    {
        $row = Plan::query()->create([
            'code' => $plan, 'name' => ucfirst($plan), 'price' => $price,
            'billing_period_months' => $months, 'grace_period_days' => 7, 'is_active' => true,
        ]);

        $tenant = Tenant::factory()->create(['business_type' => $trade, 'plan_id' => $row->id, 'addon_prices' => $own ?: null]);
        $tenant->applyModules(array_fill_keys($modules, true));

        return $tenant->fresh()->load('plan');
    }

    public function test_a_shop_on_basic_that_takes_an_add_on_is_billed_for_it_without_anybody_remembering(): void
    {
        PlatformSettings::put(['module_addon_prices' => ['customers' => 500, 'expenses' => 300, 'kitchen' => 900]]);

        $shop = $this->shop('mart', 'basic', ['products', 'pos', 'inventory', 'labels', 'customers']);
        $bill = ModulePackages::bill($shop);

        // Still Basic. The add-on is on the shop, not on a plan made for it.
        $this->assertSame('Basic', $bill['plan']['name']);
        $this->assertSame(2499.0, $bill['plan']['price']);
        $this->assertSame(['customers'], array_column($bill['addons'], 'key'));
        $this->assertSame(500.0, $bill['addons'][0]['monthly']);
        $this->assertSame(2999.0, $bill['total']);

        // A second add-on is on the next bill the moment it is switched on…
        $shop->applyModules(['expenses' => true]);
        $this->assertSame(3299.0, ModulePackages::bill($shop->fresh()->load('plan'))['total']);
        // …and off it the moment it is switched off.
        $shop->applyModules(['customers' => false, 'expenses' => false]);
        $this->assertSame(2499.0, ModulePackages::bill($shop->fresh()->load('plan'))['total']);
    }

    public function test_what_the_plan_includes_is_never_charged_twice_and_an_unpriced_add_on_is_free(): void
    {
        // Promotions is written down at nought — which is "no price", however it got there.
        PlatformSettings::put(['module_addon_prices' => ['labels' => 400, 'inventory' => 400, 'customers' => 500, 'promotions' => 0]]);
        $this->assertArrayNotHasKey('promotions', ModulePackages::prices());

        // Labels and Inventory are IN Basic for a mart. Promotions has no price.
        $bill = ModulePackages::bill($this->shop('mart', 'basic', ['products', 'pos', 'inventory', 'labels', 'promotions']));

        $this->assertSame(['promotions'], array_column($bill['addons'], 'key'));
        $this->assertSame(0.0, $bill['addons'][0]['monthly']);
        $this->assertNull($bill['addons'][0]['listed']);
        $this->assertSame(2499.0, $bill['total']);
    }

    public function test_a_shop_given_its_own_price_pays_that_and_free_is_a_price(): void
    {
        PlatformSettings::put(['module_addon_prices' => ['customers' => 500, 'expenses' => 300]]);

        $bill = ModulePackages::bill($this->shop(
            'mart', 'basic', ['products', 'pos', 'inventory', 'labels', 'customers', 'expenses'],
            own: ['customers' => 250, 'expenses' => 0],
        ));
        $lines = collect($bill['addons'])->keyBy('key');

        $this->assertSame(250.0, $lines['customers']['monthly']);
        $this->assertSame(500.0, $lines['customers']['listed']);
        $this->assertTrue($lines['customers']['own_price']);
        // Thrown in free — said as nought, with the price it would have been.
        $this->assertSame(0.0, $lines['expenses']['monthly']);
        $this->assertTrue($lines['expenses']['own_price']);
        $this->assertSame(2749.0, $bill['total']);
    }

    public function test_an_add_on_is_priced_by_the_month_and_a_plan_paid_by_the_year_pays_twelve_of_them(): void
    {
        PlatformSettings::put(['module_addon_prices' => ['customers' => 500]]);

        $bill = ModulePackages::bill($this->shop(
            'mart', 'basic', ['products', 'pos', 'inventory', 'labels', 'customers'], months: 12, price: 24000,
        ));

        $this->assertSame(12, $bill['plan']['months']);
        $this->assertSame(500.0, $bill['addons_monthly']);
        $this->assertSame(6000.0, $bill['addons_total']);
        $this->assertSame(30000.0, $bill['total']);
    }

    public function test_a_shop_with_no_plan_has_a_bill_of_nothing_rather_than_an_error(): void
    {
        $tenant = Tenant::factory()->create(['business_type' => 'mart', 'plan_id' => null]);
        $tenant->applyModules(['products' => true, 'pos' => true]);

        $bill = ModulePackages::bill($tenant->fresh()->load('plan'));

        $this->assertNull($bill['plan']['name']);
        $this->assertSame(0.0, $bill['total']);
    }

    public function test_giving_a_shop_what_is_proposed_stores_exactly_that(): void
    {
        $offer = ModulePackages::propose('food', $this->plan('premium'));

        $tenant = Tenant::factory()->create(['business_type' => 'food']);
        $tenant->applyModules($offer['modules']);

        $stored = $this->on(array_intersect_key($tenant->fresh()->features, array_flip(Modules::keys())));
        $this->assertEqualsCanonicalizing($offer['included'], $stored);
    }
}
