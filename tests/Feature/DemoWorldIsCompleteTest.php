<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchSoldOut;
use App\Models\CashSession;
use App\Models\Collection;
use App\Models\ComboItem;
use App\Models\CustomerAddress;
use App\Models\CustomerLedgerEntry;
use App\Models\CustomerVehicle;
use App\Models\DiningTable;
use App\Models\Enquiry;
use App\Models\Expense;
use App\Models\ExpenseBudget;
use App\Models\ExpenseCategory;
use App\Models\ForecourtShift;
use App\Models\FuelNozzle;
use App\Models\FuelTank;
use App\Models\Income;
use App\Models\KitchenTicket;
use App\Models\LoyaltyEntry;
use App\Models\ModifierGroup;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductBatch;
use App\Models\ProductSerial;
use App\Models\ProductVariant;
use App\Models\PurchaseOrder;
use App\Models\RecipeItem;
use App\Models\RecurringExpense;
use App\Models\Register;
use App\Models\Reservation;
use App\Models\RestaurantTicket;
use App\Models\Rider;
use App\Models\SaleItem;
use App\Models\SaleItemSerial;
use App\Models\SaleReturn;
use App\Models\SaleTradeIn;
use App\Models\ShopRequest;
use App\Models\StockCount;
use App\Models\StockDisposal;
use App\Models\StockTransfer;
use App\Models\Tenant;
use App\Models\WarrantyClaim;
use Database\Seeders\CitySeeder;
use Database\Seeders\DemoDataSeeder;
use Database\Seeders\DemoTenantSeeder;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The demo world has to contain the features that shipped into it.
 *
 * For weeks it did not. Refunds, income, budgets, schedules and closed shifts
 * were all built, tested, and then absent from every demo tenant — so the only
 * way to see any of them was to type the data in by hand, and the branch-scope
 * work could not be shown at all because a refund never existed. A seeder that
 * silently stops covering the product is the same failure as a screen that
 * silently stops rendering it: everything passes, and nothing is there.
 *
 * These assertions are deliberately about PRESENCE and SHAPE, not counts. The
 * demo world is meant to keep growing; what must not happen again is a whole
 * feature having no row anywhere.
 */
class DemoWorldIsCompleteTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('public');
        // DemoTenantSeeder is in the list because Demo Mart is the shop the
        // documented local credentials open, and it spent months with every
        // module switched on and not one row behind any of them.
        $this->seed([CitySeeder::class, PlanSeeder::class, DemoTenantSeeder::class, DemoDataSeeder::class]);
    }

    public function test_the_chain_actually_has_more_than_one_branch(): void
    {
        // Every money screen scopes by branch. With one branch per tenant a
        // scoping bug looks exactly like a working one, so the demo world needs
        // at least one shop where the filter has something to do.
        $chain = Tenant::query()->where('business_name', 'Metro Chain Superstore')->firstOrFail();

        $branches = Branch::withoutTenancy()->where('tenant_id', $chain->id)->get();

        $this->assertGreaterThan(1, $branches->count(), 'The chain has a single branch — branch scope cannot be demonstrated.');
        $this->assertSame(1, $branches->where('is_default', true)->count(), 'A shop has exactly one default branch.');
    }

    public function test_a_refund_exists_and_belongs_to_the_branch_of_its_sale(): void
    {
        // The invariant the branch-scope migration exists to hold: a refund
        // belongs to the trade it reverses, not the till that paid it out.
        $return = SaleReturn::withoutTenancy()->with('sale')->first();

        $this->assertNotNull($return, 'No demo tenant has a refund — the whole branch-scope fix is invisible.');
        $this->assertSame($return->sale->branch_id, $return->branch_id);
    }

    public function test_income_exists_and_one_row_carries_a_receipt_that_resolves(): void
    {
        $incomes = Income::withoutTenancy()->get();

        $this->assertNotEmpty($incomes, 'No income anywhere — the Cashbook shows only one side of the book.');

        $withReceipt = $incomes->firstWhere(fn (Income $i): bool => $i->attachment_path !== null);

        $this->assertNotNull($withReceipt, 'No income row has a receipt, which is the column that was unreachable.');
        // A path pointing at nothing renders a broken link, which demonstrates
        // the opposite of what the receipt feature does.
        $this->assertTrue(
            Storage::disk('public')->exists($withReceipt->attachment_path),
            'The receipt path points at a file that does not exist.',
        );
        $this->assertNotNull($withReceipt->attachment_url);
    }

    public function test_expenses_carry_the_three_things_that_used_to_be_unreachable(): void
    {
        $expenses = Expense::withoutTenancy()->get();

        $this->assertNotNull(
            $expenses->firstWhere(fn (Expense $e): bool => $e->supplier_id !== null),
            'No expense names a supplier, so the supplier picker has nothing to show.',
        );
        $this->assertNotNull(
            $expenses->firstWhere(fn (Expense $e): bool => $e->recurring_expense_id !== null),
            'No expense came from a schedule, so the `scheduled` badge never appears.',
        );
        $this->assertNotNull(
            $expenses->firstWhere(fn (Expense $e): bool => $e->notes !== null),
            'No expense has notes.',
        );
    }

    public function test_a_two_branch_shop_has_spend_on_both_sides(): void
    {
        // A branch filter that silently returns everything is invisible when
        // every row belongs to the only branch there is.
        $chain = Tenant::query()->where('business_name', 'Metro Chain Superstore')->firstOrFail();

        $branchesWithSpend = Expense::withoutTenancy()
            ->where('tenant_id', $chain->id)
            ->distinct()
            ->pluck('branch_id')
            ->filter()
            ->count();

        $this->assertGreaterThan(1, $branchesWithSpend);
    }

    public function test_both_schedule_states_exist(): void
    {
        $schedules = RecurringExpense::withoutTenancy()->get();

        $this->assertNotEmpty($schedules);
        $this->assertNotNull($schedules->firstWhere('is_active', true));
        // "Active" looks like the only state when every row is.
        $this->assertNotNull($schedules->firstWhere('is_active', false), 'No paused schedule — the list shows one state only.');
    }

    public function test_budgets_cover_both_shapes_and_survive_a_retired_category(): void
    {
        $budgets = ExpenseBudget::withoutTenancy()->get();

        $this->assertNotEmpty($budgets, 'No budgets — the Budgets tab is empty in every demo tenant.');
        $this->assertNotNull($budgets->firstWhere(fn ($b): bool => $b->month === null), 'No standing budget.');
        $this->assertNotNull($budgets->firstWhere(fn ($b): bool => $b->month !== null), 'No month-specific budget.');

        // The case the Budgets tab used to drop: close a category mid-month and
        // the money already spent against it vanished off the screen.
        $retiredIds = ExpenseCategory::withoutTenancy()->where('is_active', false)->pluck('id');

        $this->assertNotEmpty($retiredIds, 'No retired expense category — the `closed` badge has nothing to mark.');
        $this->assertNotNull(
            $budgets->firstWhere(fn ($b): bool => $retiredIds->contains($b->expense_category_id)),
            'No budget survives against a retired category.',
        );
    }

    public function test_a_shift_was_opened_and_counted_out(): void
    {
        $closed = CashSession::withoutTenancy()->where('status', '!=', 'open')->first();

        $this->assertNotNull($closed, 'No closed shift — Day & banking → Shifts is empty.');
        $this->assertNotNull($closed->closed_at);
        // A drawer that balances exactly every time never shows what the
        // variance column is for.
        $this->assertNotEquals(0.0, (float) $closed->variance);
    }

    /**
     * WHAT A MODULE IS GIVEN, IT MUST HAVE SOMETHING BEHIND.
     *
     * The tests above this one were written by hand, feature by feature, which
     * means they could only ever cover what their author remembered. They went
     * on passing for a fortnight while sizes, recipes, deals, dine-in, the
     * forecourt, serials, khata and points all shipped into a demo world that
     * had none of them — and the two worst cases were modules switched ON with
     * an empty table underneath: a restaurant given dine-in with no tables to
     * seat anyone, and a station given the forecourt with no tank, which made
     * `OpenForecourtShiftAction` answer NO_FORECOURT_CONFIGURED to a shop that
     * was supposed to be demonstrating it.
     *
     * So this one is driven by a MAP rather than by memory: switch a module on
     * for a demo shop and this test names the table you have to fill.
     *
     * @return array<string, list<array{0:class-string, 1:array<string,mixed>}>>
     */
    private function moduleNeeds(): array
    {
        return [
            'products' => [[Product::class, ['type' => 'product']]],
            'services' => [[Product::class, ['type' => 'service']]],
            'pos' => [[Register::class, []], [CashSession::class, []]],
            'inventory' => [[PurchaseOrder::class, []], [StockCount::class, []]],
            'expenses' => [[Expense::class, []]],
            'marketplace' => [[Collection::class, []]],
            'delivery' => [[Rider::class, []]],
            'dine_in' => [[DiningTable::class, []]],
            'fuel' => [[FuelTank::class, []], [FuelNozzle::class, []]],
            'reservations' => [[Reservation::class, []]],
        ];
    }

    public function test_every_module_a_demo_shop_is_given_has_something_behind_it(): void
    {
        $needs = $this->moduleNeeds();

        // The try-demo shops are made by CreateDemoShopAction and age out on
        // their own; this is about the world the seeder builds.
        $shops = Tenant::query()->where('is_demo', false)->get();

        $empty = [];
        $checked = 0;
        $modulesSeen = [];

        foreach ($shops as $shop) {
            foreach ($needs as $module => $tables) {
                if (! $shop->featureEnabled($module)) {
                    continue;
                }

                $modulesSeen[$module] = true;

                foreach ($tables as [$model, $where]) {
                    $checked++;

                    $rows = $model::withoutTenancy()->where('tenant_id', $shop->id);
                    foreach ($where as $column => $value) {
                        $rows->where($column, $value);
                    }

                    if ($rows->count() === 0) {
                        $empty[] = "{$shop->business_name}: '{$module}' is on, but ".class_basename($model).' is empty';
                    }
                }
            }
        }

        $this->assertSame([], $empty, "A module is switched on with nothing behind it:\n".implode("\n", $empty));

        // DENOMINATOR. Without these the test passes for having looked at an
        // empty world — which is exactly how it would greet a seeder that had
        // stopped producing shops at all.
        $this->assertGreaterThanOrEqual(9, $shops->count(), 'The demo world has lost shops.');
        $this->assertGreaterThanOrEqual(60, $checked, 'Too few module/table pairs examined — the map or the world shrank.');
        // Sorted, because $modulesSeen is keyed in the order the shops were
        // walked and $needs in the order it was written — comparing them
        // as-is failed on a demo world where all ten modules WERE covered.
        $seen = array_keys($modulesSeen);
        $wanted = array_keys($needs);
        sort($seen);
        sort($wanted);

        $this->assertSame(
            $wanted,
            $seen,
            'Some module in the map is switched on in NO demo shop, so nothing tests it.',
        );
    }

    public function test_sizes_exist_and_one_of_them_was_actually_sold(): void
    {
        $variants = ProductVariant::withoutTenancy()->get();

        $this->assertNotEmpty($variants, 'No product has sizes — the picker, per-size stock and per-size 86 have nothing to stand on.');

        // A varianted parent holds no stock of its own; the sizes carry it.
        // See Product::stockOnHand(), which sums them.
        $parent = Product::withoutTenancy()->has('variants')->where('track_inventory', true)->first();
        $this->assertNotNull($parent);
        $this->assertSame(0.0, (float) $parent->stock_quantity, 'A parent with sizes is holding stock of its own — it is counted twice.');
        $this->assertGreaterThan(0, $parent->variants()->sum('stock_quantity'));

        // Both seedSales and seedPurchases say doesntHave('variants'), so
        // without a deliberate one no size had ever appeared on a sale.
        $this->assertTrue(
            SaleItem::withoutTenancy()->whereNotNull('variant_id')->exists(),
            'No sale line names a size, so nothing that reports by size has anything to report.',
        );

        // A code per size is the reason ProductBarcode carries variant_id.
        $this->assertTrue(
            ProductBarcode::withoutTenancy()->whereNotNull('variant_id')->exists(),
            'No size carries its own barcode.',
        );
        $this->assertTrue(
            Product::withoutTenancy()->whereNotNull('barcode')->exists(),
            'Not one product carries a barcode — the scanner box has nothing to find.',
        );
    }

    public function test_the_kitchen_knows_its_recipes_its_deals_and_what_ran_out(): void
    {
        $this->assertTrue(RecipeItem::withoutTenancy()->exists(), 'No dish has a recipe, so RecipeCost has nothing to price.');
        $this->assertTrue(
            RecipeItem::withoutTenancy()->whereNotNull('variant_id')->exists(),
            'No recipe row belongs to a SIZE — the override RecipeFor exists for is not demonstrated.',
        );

        $this->assertTrue(ComboItem::withoutTenancy()->exists(), 'No deal contains anything.');
        $this->assertTrue(
            ComboItem::withoutTenancy()->whereNotNull('variant_id')->exists(),
            'No deal names a SIZE, which is the case a deal with a sized item could not express at all.',
        );

        // Eighty-six, in both shapes.
        $off = BranchSoldOut::withoutTenancy()->get();
        $this->assertNotEmpty($off, 'Nothing is 86’d anywhere.');
        $this->assertNotNull($off->firstWhere(fn ($r) => $r->variant_id === null), 'No whole item is off.');
        $this->assertNotNull($off->firstWhere(fn ($r) => $r->variant_id !== null), 'No single SIZE is off — "the large ran out" cannot be shown.');

        $this->assertTrue(ModifierGroup::withoutTenancy()->exists(), 'No item asks how the customer wants it.');
    }

    public function test_the_floor_and_the_forecourt_are_configured_enough_to_work(): void
    {
        $restaurant = Tenant::query()->where('business_name', 'Karahi House')->firstOrFail();

        $this->assertTrue($restaurant->featureEnabled('dine_in'));
        $this->assertGreaterThan(
            0,
            DiningTable::withoutTenancy()->where('tenant_id', $restaurant->id)->count(),
            'The restaurant has dine-in and no tables, so no tab can be opened and the kitchen board stays empty.',
        );
        $this->assertTrue(
            RestaurantTicket::withoutTenancy()->where('tenant_id', $restaurant->id)->exists(),
            'No tab is running.',
        );
        $this->assertTrue(
            KitchenTicket::withoutTenancy()->where('tenant_id', $restaurant->id)->exists(),
            'Nothing is on the pass.',
        );

        $station = Tenant::query()->where('business_name', 'Highway Fuel Station')->firstOrFail();

        // The exact refusal this used to produce: NO_FORECOURT_CONFIGURED.
        $this->assertGreaterThan(0, FuelTank::withoutTenancy()->where('tenant_id', $station->id)->count());
        $this->assertGreaterThan(0, FuelNozzle::withoutTenancy()->where('tenant_id', $station->id)->count());

        $shifts = ForecourtShift::withoutTenancy()->where('tenant_id', $station->id)->get();
        $this->assertNotNull($shifts->firstWhere('status', ForecourtShift::STATUS_OPEN), 'No shift is running.');
        $closed = $shifts->firstWhere(fn ($s) => $s->status !== ForecourtShift::STATUS_OPEN);
        $this->assertNotNull($closed, 'No reconciled shift — the variance column has never been filled.');
        $this->assertGreaterThan(0.0, (float) $closed->litres_sold);
    }

    public function test_the_counter_remembers_serials_debts_and_points(): void
    {
        $this->assertTrue(ProductSerial::withoutTenancy()->exists(), 'No serialized unit was ever received.');
        $this->assertTrue(SaleItemSerial::withoutTenancy()->exists(), 'No unit left the shop with its number on the receipt.');

        $claims = WarrantyClaim::withoutTenancy()->get();
        $this->assertNotEmpty($claims, 'The warranty desk is empty.');
        $this->assertNotNull($claims->firstWhere(fn ($c) => $c->resolution === null), 'No open claim.');
        $this->assertNotNull($claims->firstWhere(fn ($c) => $c->resolution !== null), 'No resolved claim — the desk shows one state only.');

        $this->assertTrue(CustomerVehicle::withoutTenancy()->exists(), 'The garage has no vehicle on file.');
        $this->assertTrue(
            SaleTradeIn::withoutTenancy()->exists(),
            'Nothing was taken in part-exchange — a trade-in is a TENDER and there is no example of one.',
        );

        // Both ledgers, and the balances that fall out of them.
        $ledger = CustomerLedgerEntry::withoutTenancy()->get();
        $this->assertNotEmpty($ledger, 'No khata entry anywhere.');
        $this->assertNotNull($ledger->firstWhere('type', 'charge'), 'Nothing was ever put on account.');
        $this->assertNotNull($ledger->firstWhere('type', 'payment'), 'Nothing was ever paid back.');

        $points = LoyaltyEntry::withoutTenancy()->get();
        $this->assertNotNull($points->firstWhere('type', 'earn'), 'No points were earned.');
        $this->assertNotNull($points->firstWhere('type', 'redeem'), 'No points were spent — a balance that only counts up.');
    }

    public function test_the_shelf_has_dated_lots_and_not_one_of_them_blocks_a_sale(): void
    {
        $live = ProductBatch::withoutTenancy()->where('quantity', '>', 0)->get();

        $this->assertNotEmpty($live, 'No lot anywhere — FEFO has nothing to order and near-expiry counts to zero.');

        // THE ONE THAT MUST NOT COME BACK. InventoryService fences expired
        // quantity out of what may be sold, so a product whose only lot has
        // expired cannot be rung at all. Eleven were seeded that way first
        // time round: eleven demo products that refused to sell.
        $expired = $live->filter(fn ($b) => $b->expiry_date !== null && $b->expiry_date->isPast());
        $this->assertCount(
            0,
            $expired,
            'Expired stock is sitting on the shelf — every product it belongs to is now unsellable at the till.',
        );

        $this->assertTrue(
            $live->contains(fn ($b) => $b->expiry_date !== null && $b->expiry_date->lte(now()->addDays(90))),
            'Nothing is near expiry, so the alert window and the dashboard count can never show a number.',
        );

        // A tyre does not expire, it ages — and that date is a DOT code.
        $this->assertTrue(
            ProductBatch::withoutTenancy()->whereNotNull('dot_code')->exists(),
            'No lot carries a DOT code, so the other half of a date is undemonstrated.',
        );

        $disposals = StockDisposal::withoutTenancy()->get();
        $this->assertNotNull($disposals->firstWhere('disposition', StockDisposal::WRITTEN_OFF), 'Nothing was written off.');
        $this->assertNotNull(
            $disposals->firstWhere('disposition', StockDisposal::RETURNED),
            'Nothing was sent back for credit — the two dispositions are never summed and only one exists.',
        );

        $count = StockCount::withoutTenancy()->first();
        $this->assertNotNull($count, 'No stock count was ever run.');
        $this->assertNotEquals(0.0, (float) $count->variance_units, 'A count where everything agreed proves nothing about the variance column.');

        $this->assertTrue(StockTransfer::withoutTenancy()->exists(), 'The chain never moved stock between its own branches.');
    }

    public function test_the_platform_desk_has_people_asking_and_a_shop_asking_to_be_kept(): void
    {
        $enquiries = Enquiry::query()->get();

        $this->assertNotEmpty($enquiries, 'The enquiries queue is empty — the newest admin screen shows nothing.');
        $this->assertNotNull($enquiries->firstWhere('kind', Enquiry::WALKTHROUGH));
        $this->assertNotNull($enquiries->firstWhere('kind', Enquiry::QUESTION));
        $this->assertNotNull($enquiries->firstWhere('status', Enquiry::NEW));
        $this->assertNotNull($enquiries->firstWhere(fn ($e) => $e->status !== Enquiry::NEW), 'Every enquiry is new — the queue shows one state only.');

        $this->assertTrue(
            Tenant::query()->where('is_demo', true)->exists(),
            'Nobody ever spun a shop up from the landing page.',
        );
        $this->assertTrue(
            ShopRequest::query()->where('status', ShopRequest::PENDING)->exists(),
            'No demo shop is asking to be kept, so the admin approval flow has nothing to approve.',
        );

        $this->assertTrue(CustomerAddress::query()->exists(), 'No customer has an address — a delivery has nowhere to go.');
    }

    public function test_re_running_the_seeder_does_not_duplicate_the_money_block(): void
    {
        // The seeder's own promise. Branch creation moved OUTSIDE the
        // "already seeded" guard so a shop can gain a branch later — which is
        // exactly the shape that duplicates if it is not keyed properly.
        // Every table the seeder writes to, not only the money block. The
        // equipment and depth passes run OUTSIDE the "already seeded" guard so
        // an older demo world gains them — which is exactly the shape that
        // duplicates on the second run if its own key is wrong.
        $tables = [
            Branch::class, Expense::class, Income::class, ExpenseBudget::class,
            RecurringExpense::class, SaleReturn::class, Product::class,
            ProductVariant::class, ProductBarcode::class, ProductBatch::class,
            ProductSerial::class, RecipeItem::class, ComboItem::class,
            BranchSoldOut::class, ModifierGroup::class, DiningTable::class,
            RestaurantTicket::class, KitchenTicket::class, FuelTank::class,
            FuelNozzle::class, ForecourtShift::class, Register::class,
            StockCount::class, StockDisposal::class, StockTransfer::class,
            WarrantyClaim::class, CustomerVehicle::class, SaleTradeIn::class,
            CustomerLedgerEntry::class, LoyaltyEntry::class, Rider::class,
            Enquiry::class, ShopRequest::class, CustomerAddress::class,
        ];

        $census = function () use ($tables): array {
            $out = [];
            foreach ($tables as $model) {
                $out[class_basename($model)] = $model::query()->count();
            }

            return $out;
        };

        $before = $census();

        // Not one of these may be empty, or "unchanged" is a claim about
        // nothing — the denominator this assertion needs.
        $this->assertSame([], array_keys(array_filter($before, fn (int $n): bool => $n === 0)));

        $this->seed(DemoDataSeeder::class);

        $this->assertSame($before, $census());
    }
}
