<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\City;
use App\Models\Plan;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A grocery/mart, walked from an empty shop to a closed day — the QA pass.
 *
 * `TradeWorkflowTest` walks one short chain per trade. This file walks the ONE
 * trade the shop actually lives on, the whole way, and each test ends at a
 * DIFFERENT module from the one it started in:
 *
 *   catalog → supplier → PO (part-delivered) → shelf → valuation report
 *   PO → supplier payment → what the shop owes → purchases report
 *   threshold set → sold down → the reorder list (the boundary, exactly)
 *   sell → refund → expense → income → one cashbook
 *   branch opened → stock transferred → each branch's own shelf and takings
 *   branch sold out → what its own reorder list says (today: nothing)
 *   goods received at a branch → whose shelf they land on (today: the wrong one)
 *   budget set → bills recorded → budget page and cashbook agree
 *   cashier hired → can ring a sale → cannot open the margin report
 *
 * Every assertion is on a FIGURE. No envelope is ever checked for "not empty":
 * the cashbook draws a row per day whether or not the shutter went up, and the
 * budget page draws a row per category whether or not a rupee was spent, so a
 * count-based assertion is true of a shop that never traded.
 */
class MartTenantWalkthroughTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    // ── 1. Buying: catalog → supplier → part-delivered PO → shelf ────

    public function test_a_grocery_stocks_its_shelves_from_a_half_delivered_purchase_order(): void
    {
        // The delivery van bringing less than the order is the normal case, not
        // the edge case. What has to survive it: the shelf moves by what ARRIVED
        // (not what was ordered), the order stays open for the rest, and the
        // stock report — a different module entirely — values what is really
        // there. A PO that closes on a short delivery silently writes off the
        // balance the supplier still owes.
        [$shop, $owner] = $this->shop();

        $aisle = $this->as($owner)->postJson('/api/v1/categories', ['name' => 'Dry Goods'])
            ->assertCreated()->json('data.id');

        // A real mart item: cost and price both set (the cost is what the
        // valuation and the margin report read), a scanned barcode, a second
        // barcode for the old print run, and a Carton that holds 12.
        $rice = $this->as($owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product',
            'name' => 'Basmati Rice 5kg',
            'category_id' => $aisle,
            'sku' => 'RICE-5KG',
            'barcode' => '8964000010011',
            'barcodes' => ['8964000010028'],
            'units' => [['name' => 'Carton', 'factor' => 12]],
            'price' => 2500,
            'cost' => 1800,
            'stock_quantity' => 0,
            'low_stock_threshold' => 5,
            'track_inventory' => true,
        ])->assertCreated()->json('data');

        $this->assertEquals(1800, $rice['cost'], 'The cost price did not stick — every margin figure downstream reads it.');

        // The old barcode still on last season's packs must find the item, or
        // the cashier types the price in by hand and the shop loses the audit.
        $found = $this->as($owner)->getJson('/api/v1/products?search=8964000010028')
            ->assertOk()->json('data');
        $this->assertSame($rice['id'], $found[0]['id'] ?? null, 'An alternate barcode does not find its product.');

        $supplier = $this->as($owner)->postJson('/api/v1/suppliers', [
            'name' => 'Chishtia Wholesale', 'phone' => '+923001112233',
        ])->assertCreated()->json('data.id');

        // Raised as a draft — a shopkeeper writes the order before phoning it
        // through, and a draft must not be receivable or the stock room can
        // book in goods against an order nobody actually placed.
        $po = $this->as($owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier,
            'order_date' => now()->toDateString(),
            'status' => 'draft',
            'items' => [['product_id' => $rice['id'], 'quantity' => 20, 'unit_cost' => 1800]],
        ])->assertCreated()->json('data');

        $this->assertEquals(36000, $po['total'], '20 × 1800 is what the shop committed to.');

        $this->as($owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'PO_NOT_RECEIVABLE');
        $this->assertEquals(0, $this->stockOf($rice['id']), 'A refused receipt still moved stock.');

        $this->as($owner)->postJson("/api/v1/purchase-orders/{$po['id']}/place")
            ->assertOk()->assertJsonPath('data.status', 'ordered');

        // Half the order turns up. Twelve bags on the shelf, eight still owed.
        $partial = $this->as($owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [
            'items' => [['id' => $po['items'][0]['id'], 'quantity' => 12]],
        ])->assertOk()->json('data');

        $this->assertSame('partially_received', $partial['status'], 'A short delivery closed the order — the outstanding 8 bags are now unclaimable.');
        $this->assertEquals(12, $this->stockOf($rice['id']), 'Receiving moved the ordered quantity, not the delivered one.');
        $this->assertEquals(12, $partial['items'][0]['quantity_received']);

        // The rest arrives on Thursday and the order closes.
        $this->as($owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive")
            ->assertOk()->assertJsonPath('data.status', 'received');
        $this->assertEquals(20, $this->stockOf($rice['id']), 'The balance of the order arrived and never reached the shelf.');

        // A third receipt has nothing to take — otherwise a double-click books
        // in twenty bags that never came off a van.
        $this->as($owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'PO_NOT_RECEIVABLE');
        $this->assertEquals(20, $this->stockOf($rice['id']));

        // The far end: the stock report is a different module reading what
        // receiving wrote. 20 bags at 1800 cost, 2500 retail.
        $totals = $this->as($owner)->getJson('/api/v1/reports/valuation')
            ->assertOk()->json('data.totals');

        $this->assertEquals(20, $totals['units']);
        $this->assertEquals(36000, $totals['cost_value'], 'The shelves are not valued at what they cost.');
        $this->assertEquals(50000, $totals['retail_value']);
        $this->assertEquals(14000, $totals['potential_profit']);
    }

    // ── 2. Paying the supplier ──────────────────────────────────────

    public function test_paying_the_supplier_moves_what_the_shop_owes_on_every_screen(): void
    {
        // "How much do I still owe Chishtia?" is asked at the counter with the
        // rep standing there. Three places answer it — the order, the supplier
        // card, and the purchases report — and they are computed separately, so
        // one of them drifting is exactly the bug this catches.
        [$shop, $owner] = $this->shop();
        $rice = $this->product($shop, 'Basmati Rice 5kg', price: 2500, cost: 1800);

        $supplier = $this->as($owner)->postJson('/api/v1/suppliers', [
            'name' => 'Chishtia Wholesale', 'phone' => '+923001112233',
        ])->assertCreated()->json('data.id');

        $po = $this->as($owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier,
            'order_date' => now()->toDateString(),
            'status' => 'ordered',
            'items' => [['product_id' => $rice->id, 'quantity' => 20, 'unit_cost' => 1800]],
        ])->assertCreated()->json('data');

        // Nothing paid yet: the whole 36,000 is owed.
        $this->assertEquals(36000, $this->as($owner)->getJson("/api/v1/suppliers/{$supplier}")->json('data.outstanding'));

        // A part payment in cash — how a mart actually settles with a wholesaler.
        $this->as($owner)->postJson("/api/v1/suppliers/{$supplier}/payments", [
            'amount' => 15000, 'method' => 'cash', 'purchase_order_id' => $po['id'],
        ])->assertCreated();

        $onOrder = $this->as($owner)->getJson("/api/v1/purchase-orders/{$po['id']}")->json('data');
        $this->assertEquals(15000, $onOrder['amount_paid'], 'A recorded payment never landed on the order it was against.');
        $this->assertSame('partial', $onOrder['payment_status']);

        $this->assertEquals(21000, $this->as($owner)->getJson("/api/v1/suppliers/{$supplier}")->json('data.outstanding'),
            'The supplier card does not agree with the payment just recorded.');

        // The purchases report computes the same number by a different route.
        $report = $this->as($owner)->getJson('/api/v1/reports/purchases?'.http_build_query([
            'from' => now()->subDay()->toDateString(), 'to' => now()->addDay()->toDateString(),
        ]))->assertOk()->json('data');

        $this->assertEquals(36000, $report['totals']['ordered_value']);
        $this->assertEquals(15000, $report['totals']['paid']);
        $this->assertEquals(21000, $report['totals']['outstanding'], 'The purchases report and the supplier card disagree about the same debt.');

        // Settle the rest. Owing zero is a different state from owing nothing
        // yet, and a shopkeeper stops chasing on the strength of it.
        $this->as($owner)->postJson("/api/v1/suppliers/{$supplier}/payments", [
            'amount' => 21000, 'method' => 'cash', 'purchase_order_id' => $po['id'],
        ])->assertCreated();

        $this->assertEquals(0, $this->as($owner)->getJson("/api/v1/suppliers/{$supplier}")->json('data.outstanding'));
        $this->assertSame('paid', $this->as($owner)->getJson("/api/v1/purchase-orders/{$po['id']}")->json('data.payment_status'));

        // And a rupee more than was owed is refused — a mistyped payment that
        // sails through leaves the shop's books showing a supplier owing IT.
        $this->as($owner)->postJson("/api/v1/suppliers/{$supplier}/payments", [
            'amount' => 100, 'method' => 'cash', 'purchase_order_id' => $po['id'],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PAYMENT_EXCEEDS_DUE');

        // Rs 36,000 in cash has just left this shop — for most marts the single
        // biggest outflow of the week — and the cashbook has to know. Fixed
        // 2026-08-10; this test was written the day before to pin the gap.
        //
        // It counts ONCE, as its own `supplier_payments` column rather than as a
        // fabricated Expense: a shop that also files the wholesaler's bill would
        // otherwise see the same rupees twice.
        $today = collect($this->as($owner)->getJson('/api/v1/cashbook?'.http_build_query([
            'from' => now()->toDateString(), 'to' => now()->toDateString(),
        ]))->assertOk()->json('data.days'))->firstWhere('date', now()->toDateString());

        $this->assertEquals(36000, $today['supplier_payments'], 'The supplier run never reached the books.');
        $this->assertEquals(36000, $today['money_out'], 'Money left the shop and the day did not show it.');
        $this->assertEquals(0, $today['expenses'], 'A supplier payment was double-counted as an expense.');

        // And it opens as a line in the ledger, named, so a book-keeper can see
        // WHO was paid rather than a bare "money out".
        $lines = collect($this->as($owner)->getJson('/api/v1/ledger?'.http_build_query([
            'period' => 'custom', 'from' => now()->toDateString(), 'to' => now()->toDateString(),
            'type' => 'supplier_payment',
        ]))->assertOk()->json('data'));

        $this->assertNotEmpty($lines, 'The supplier run has no line in the ledger.');
        // Every instalment draws its own line — a book-keeper reconciles against
        // the payments the supplier acknowledges, not one merged figure.
        $this->assertEquals(36000, round($lines->sum('out'), 2));
        // Named, because a row reading "money out" is not something anyone can
        // check against a statement.
        $this->assertStringContainsString('Chishtia', (string) $lines->first()['description']);

        // Nothing was sold today, so the day is 36,000 down. It used to read 0,
        // which is the whole reason this was worth fixing: a shop that paid its
        // wholesaler was shown a flat day.
        $this->assertEquals(-36000, $today['net']);
    }

    // ── 3. The reorder list, at the exact number that was set ───────

    public function test_the_low_stock_alert_fires_at_exactly_the_number_the_shopkeeper_set(): void
    {
        // The reorder list is the one screen a mart owner opens every morning.
        // An off-by-one here is not cosmetic: at "below" rather than "at or
        // below" the shop reorders a day late every single time, and the
        // shelf is empty on the day that matters.
        //
        // So this walks the boundary by SELLING — the way stock actually falls
        // — rather than by setting a number, because the sale path and the
        // alert query are different modules and only the seam is interesting.
        [$shop, $owner] = $this->shop();

        // Threshold 5, deliberately not the default.
        $rice = $this->product($shop, 'Basmati Rice 5kg', price: 2500, cost: 1800, stock: 20, threshold: 5);
        // No threshold at all: this shop never told the system what "low" means
        // for salt, so salt must never appear — however empty it gets. A list
        // that guesses is a list nobody trusts.
        $salt = $this->product($shop, 'Iodised Salt 800g', price: 90, cost: 60, stock: 20);

        // 20 → 6. One above the line: still not a problem.
        $this->sell($owner, $rice, 14);
        $this->assertEquals(6, $this->stockOf($rice->id));
        $this->assertNotContains($rice->id, $this->reorderList($owner),
            'The alert fired one unit early — at 6 against a threshold of 5.');

        // 20 → 0 for the salt, at the same time. Still silent: no threshold set.
        $this->sell($owner, $salt, 20);
        $this->assertEquals(0, $this->stockOf($salt->id));

        // 6 → 5. AT the threshold is low: this is the day to phone the supplier.
        $this->sell($owner, $rice, 1);
        $this->assertEquals(5, $this->stockOf($rice->id), 'The bag that takes rice down to its threshold never left the shelf.');
        $this->assertContains($rice->id, $this->reorderList($owner),
            'Stock reached the configured threshold and the reorder list stayed quiet.');

        // 5 → 4. Below it, still listed — an item must not fall off the list by
        // getting worse.
        $this->sell($owner, $rice, 1);
        $this->assertEquals(4, $this->stockOf($rice->id));
        $this->assertContains($rice->id, $this->reorderList($owner));

        // The salt sat at zero through all of that and was never named.
        $this->assertNotContains($salt->id, $this->reorderList($owner),
            'An item with no threshold was put on the reorder list — the shop is now chasing stock it never asked to track.');
        $this->assertCount(1, $this->reorderList($owner));

        // The catalog filter answers the same question by a separate query, and
        // the panel's Products screen uses THAT one. The two drifting apart is
        // how a shop sees a reorder badge of 1 and an empty filtered list.
        $filtered = collect($this->as($owner)->getJson('/api/v1/products?low_stock=1')
            ->assertOk()->json('data'))->pluck('id')->all();
        $this->assertSame([$rice->id], $filtered, 'The catalog low-stock filter and the reorder list disagree.');

        // And the dashboard badge counts the same one item.
        $this->as($owner)->getJson('/api/v1/dashboard')
            ->assertOk()->assertJsonPath('data.low_stock_count', 1);

        // Restocking clears it — the alert has to switch off as well as on.
        $this->as($owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $rice->id, 'type' => 'in', 'quantity' => 10, 'reason' => 'Delivery',
        ])->assertCreated();
        $this->assertEquals(14, $this->stockOf($rice->id), 'A hand adjustment did not put the delivery back on the shelf.');
        $this->assertSame([], $this->reorderList($owner), 'A restocked item is still on the reorder list.');
    }

    // ── 4. A day's trade in one cashbook ────────────────────────────

    public function test_a_days_takings_a_refund_a_bill_and_a_side_income_all_land_in_one_cashbook(): void
    {
        // Four modules write money on an ordinary day: the till, the returns
        // desk, the expense book and the income book. The cashbook is the only
        // screen where a shopkeeper sees whether they agree, so a link that
        // silently writes nothing shows up here and nowhere else.
        //
        // Row COUNT proves nothing — the cashbook emits a row per day in the
        // range whether or not the shop opened. Every assertion below is a
        // figure.
        [$shop, $owner] = $this->shop();
        $rice = $this->product($shop, 'Basmati Rice 5kg', price: 2500, cost: 1800, stock: 20);

        // 4 bags at 2500 — no prices sent, the server is the only thing allowed
        // to price a line.
        $sale = $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $rice->id, 'quantity' => 4]],
            'payment_method' => 'cash',
            'amount_paid' => 10000,
        ])->assertCreated()->json('data');

        $this->assertEquals(10000, $sale['total']);
        $this->assertEquals(16, $this->stockOf($rice->id), 'Selling did not take the bags off the shelf.');

        // One bag comes back torn. Money out, bag back on the shelf.
        $this->as($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'refund_method' => 'cash',
            'reason' => 'Torn bag',
        ])->assertCreated()->assertJsonPath('data.refund_total', '2500.00');

        $this->assertEquals(17, $this->stockOf($rice->id), 'A refunded bag never went back on the shelf.');

        // The loader's wages, paid out of the drawer.
        $bills = $this->as($owner)->postJson('/api/v1/expense-categories', ['name' => 'Wages'])
            ->assertCreated()->json('data.id');
        $this->as($owner)->postJson('/api/v1/expenses', [
            'expense_category_id' => $bills,
            'description' => 'Loader — daily wage',
            'amount' => 1200,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'cash',
        ])->assertCreated();

        // Rent from the ATM in the corner: money the shop takes that is not a
        // sale. If the cashbook only knows about sales this figure disappears
        // and the day's net is wrong by exactly this much.
        $side = $this->as($owner)->postJson('/api/v1/income-categories', ['name' => 'Rent Received'])
            ->assertCreated()->json('data.id');
        $this->as($owner)->postJson('/api/v1/incomes', [
            'income_category_id' => $side,
            'description' => 'ATM space rent',
            'amount' => 800,
            'income_date' => now()->toDateString(),
            'payment_method' => 'cash',
        ])->assertCreated();

        $today = collect($this->as($owner)->getJson('/api/v1/cashbook?'.http_build_query([
            'from' => now()->subDay()->toDateString(),
            'to' => now()->addDay()->toDateString(),
        ]))->assertOk()->json('data.days'))->firstWhere('date', now()->toDateString());

        $this->assertNotNull($today, 'Today is missing from the cashbook.');
        // A refunded sale still brought its money in; only a cancelled one
        // never happened. So the sale counts in full and the refund is money
        // out — netting them at source would hide both events.
        $this->assertEquals(10000, $today['sales_revenue'], 'The till takings never reached the books.');
        $this->assertEquals(2500, $today['refunds'], 'The refund never reached the books.');
        $this->assertEquals(1200, $today['expenses'], 'The wage bill never reached the books.');
        $this->assertEquals(800, $today['other_income'], 'Income that was not a sale never reached the books.');
        $this->assertEquals(10800, $today['money_in']);
        $this->assertEquals(3700, $today['money_out']);
        $this->assertEquals(7100, $today['net'], 'The four modules do not add up to one day.');
    }

    // ── 5. A second branch ──────────────────────────────────────────

    public function test_a_second_branch_keeps_its_own_shelf_and_its_own_takings(): void
    {
        // A mart opening a second shop is the moment every "the shop" figure
        // has to become "this shop". The failure that matters is silent: both
        // branches reading the same number, so the owner moves stock to cover a
        // shortage that was never there.
        [$shop, $owner] = $this->shop(branches: 2);
        $rice = $this->product($shop, 'Basmati Rice 5kg', price: 2500, cost: 1800, stock: 20);

        $main = Branch::withoutTenancy()->where('tenant_id', $shop->id)->where('is_default', true)->firstOrFail();

        $gulberg = $this->as($owner)->postJson('/api/v1/branches', ['name' => 'Gulberg'])
            ->assertCreated()->json('data.id');

        // Six bags go across town in the shop's own van.
        $this->as($owner)->postJson('/api/v1/inventory/transfers', [
            'from_branch_id' => $main->id,
            'to_branch_id' => $gulberg,
            'items' => [['product_id' => $rice->id, 'quantity' => 6]],
        ])->assertCreated();

        $shelves = collect($this->as($owner)->getJson("/api/v1/products/{$rice->id}/branch-stock")
            ->assertOk()->json('data'))->keyBy('branch');

        $this->assertEquals(14, $shelves['Main']['quantity'], 'The transfer did not leave the sending branch.');
        $this->assertEquals(6, $shelves['Gulberg']['quantity'], 'The transfer never arrived.');
        // The catalog number is the sum of the shelves, not one of them.
        $this->assertEquals(20, $this->stockOf($rice->id));

        // Two bags sold at Gulberg. Only Gulberg's shelf may move.
        $this->as($owner)->withHeaders(['X-Branch-Id' => $gulberg])->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $rice->id, 'quantity' => 2]],
            'payment_method' => 'cash', 'amount_paid' => 5000,
        ])->assertCreated();

        // One bag sold at Main.
        $this->as($owner)->withHeaders(['X-Branch-Id' => $main->id])->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $rice->id, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 2500,
        ])->assertCreated();

        $shelves = collect($this->as($owner)->getJson("/api/v1/products/{$rice->id}/branch-stock")
            ->assertOk()->json('data'))->keyBy('branch');
        $this->assertEquals(13, $shelves['Main']['quantity']);
        $this->assertEquals(4, $shelves['Gulberg']['quantity'], 'A sale at one branch came off the other branch\'s shelf.');
        $this->assertEquals(17, $this->stockOf($rice->id));

        // Reads: unfocused the owner sees the whole business, focused they see
        // one shop. Same endpoint, same owner, two different true answers.
        $this->assertSame(2, $this->as($owner)->getJson('/api/v1/sales')->assertOk()->json('meta.pagination.total'));
        $this->assertSame(1, $this->as($owner)->withHeaders(['X-Branch-Id' => $gulberg])
            ->getJson('/api/v1/sales')->assertOk()->json('meta.pagination.total'));

        // And the money follows the same scope — 5000 at Gulberg, 2500 at Main,
        // 7500 across the business.
        $this->assertEquals(7500, $this->todaysRevenue($owner));
        $this->assertEquals(5000, $this->todaysRevenue($owner, $gulberg), 'The cashbook is showing one branch the whole business\'s takings.');
        $this->assertEquals(2500, $this->todaysRevenue($owner, $main->id));

        // The stock report scopes too: a bank meeting about one shop must not
        // be shown the other shop's shelves.
        $this->assertEquals(4 * 1800, $this->as($owner)->withHeaders(['X-Branch-Id' => $gulberg])
            ->getJson('/api/v1/reports/valuation')->assertOk()->json('data.totals.cost_value'));
    }

    // ── 6. The reorder list does not know about branches ────────────

    public function test_a_branch_that_has_sold_out_is_not_on_its_own_reorder_list(): void
    {
        // GAP, pinned as it stands today (2026-08-10).
        //
        // The reorder list (GET /inventory/low-stock, the dashboard badge and
        // ?low_stock=1 alike) compares products.stock_quantity — the ACROSS-ALL-
        // BRANCHES rollup — against the threshold, and takes no branch scope at
        // all. Sales, the cashbook and the valuation report all scope; this
        // one does not.
        //
        // What the shopkeeper sees: Gulberg sells its last bag, the manager
        // opens the reorder list on the Gulberg screen, and rice is not on it,
        // because Main still has fifteen bags across town. The one screen whose
        // whole job is "what do I need to order" is blind to the branch asking.
        //
        // SHOULD BE: low-stock reads branch_stock under a branch scope, the way
        // the valuation report already does. Asserted as-is so the suite stays
        // green.
        [$shop, $owner] = $this->shop(branches: 2);
        $rice = $this->product($shop, 'Basmati Rice 5kg', price: 2500, cost: 1800, stock: 20, threshold: 5);

        $main = Branch::withoutTenancy()->where('tenant_id', $shop->id)->where('is_default', true)->firstOrFail();
        $gulberg = $this->as($owner)->postJson('/api/v1/branches', ['name' => 'Gulberg'])
            ->assertCreated()->json('data.id');

        // Five bags sent over, and Gulberg sells all five.
        $this->as($owner)->postJson('/api/v1/inventory/transfers', [
            'from_branch_id' => $main->id,
            'to_branch_id' => $gulberg,
            'items' => [['product_id' => $rice->id, 'quantity' => 5]],
        ])->assertCreated();

        $this->as($owner)->withHeaders(['X-Branch-Id' => $gulberg])->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $rice->id, 'quantity' => 5]],
            'payment_method' => 'cash', 'amount_paid' => 12500,
        ])->assertCreated();

        $shelves = collect($this->as($owner)->getJson("/api/v1/products/{$rice->id}/branch-stock")
            ->assertOk()->json('data'))->keyBy('branch');

        // Gulberg's shelf is empty. Main's is not.
        $this->assertEquals(0, $shelves['Gulberg']['quantity'], 'Gulberg should have sold out — the shelf figure is wrong.');
        $this->assertEquals(15, $shelves['Main']['quantity']);

        // Asked from inside Gulberg, with its shelf at zero against a threshold
        // of 5, the rice is on the reorder list. Fixed 2026-08-10 — it used to
        // answer about the tenant-wide roll-up of 15, which is above 5, so the
        // manager whose shelf was actually bare was shown an empty screen on
        // precisely the morning it mattered.
        $onGulberg = collect($this->as($owner)->withHeaders(['X-Branch-Id' => $gulberg])
            ->getJson('/api/v1/inventory/low-stock')->assertOk()->json('data'))->pluck('id')->all();

        $this->assertSame([$rice->id], $onGulberg, 'A sold-out branch is not on its own reorder list.');

        // Main still holds 15 against the same threshold, so it is NOT low —
        // the same product, two branches, two correct answers.
        $onMain = collect($this->as($owner)->withHeaders(['X-Branch-Id' => $main->id])
            ->getJson('/api/v1/inventory/low-stock')->assertOk()->json('data'))->pluck('id')->all();

        $this->assertSame([], $onMain, 'A branch with stock was told to reorder.');
        $this->assertEquals(15, $this->stockOf($rice->id));
    }

    // ── 7. The seam that is broken: receiving ignores the branch ─────

    public function test_receiving_a_delivery_while_working_at_the_second_branch_credits_that_branch(): void
    {
        // A receipt credits the branch it was booked in at, exactly as a sale
        // debits it. Fixed 2026-08-10; this test was written the day before to
        // pin the bug and then flipped.
        //
        // It used to go the other way: ReceivePurchaseOrderAction called
        // InventoryService::adjust() with no branch_id and adjust() fell back to
        // the tenant's DEFAULT branch. The van unloaded at Gulberg, the storeman
        // booked it in on the Gulberg screen, and twenty bags appeared on Main's
        // shelf — after which Gulberg refused to sell what was standing in its
        // own stockroom, and the owner was told to transfer stock already there.
        //
        // Receiving takes BranchContext::id() (the OPERATING branch) rather than
        // scopeId(), which is null in an all-branches view: a delivery has to
        // land somewhere concrete.
        [$shop, $owner] = $this->shop(branches: 2);
        $rice = $this->product($shop, 'Basmati Rice 5kg', price: 2500, cost: 1800);

        $main = Branch::withoutTenancy()->where('tenant_id', $shop->id)->where('is_default', true)->firstOrFail();
        $gulberg = $this->as($owner)->postJson('/api/v1/branches', ['name' => 'Gulberg'])
            ->assertCreated()->json('data.id');

        $supplier = $this->as($owner)->postJson('/api/v1/suppliers', ['name' => 'Chishtia Wholesale'])
            ->assertCreated()->json('data.id');

        $po = $this->as($owner)->withHeaders(['X-Branch-Id' => $gulberg])
            ->postJson('/api/v1/purchase-orders', [
                'supplier_id' => $supplier,
                'order_date' => now()->toDateString(),
                'status' => 'ordered',
                'items' => [['product_id' => $rice->id, 'quantity' => 20, 'unit_cost' => 1800]],
            ])->assertCreated()->json('data');

        // Booked in at Gulberg, on Gulberg's screen.
        $this->as($owner)->withHeaders(['X-Branch-Id' => $gulberg])
            ->postJson("/api/v1/purchase-orders/{$po['id']}/receive")
            ->assertOk()->assertJsonPath('data.status', 'received');

        $shelves = collect($this->as($owner)->getJson("/api/v1/products/{$rice->id}/branch-stock")
            ->assertOk()->json('data'))->keyBy('branch');

        // The goods land where the van unloaded them.
        $this->assertEquals(20, $shelves['Gulberg']['quantity'], 'A receipt must credit the branch it was booked in at.');
        $this->assertEquals(0, $shelves['Main']['quantity'], 'Main was credited for a delivery it never took.');

        // And the consequence that used to bite: Gulberg can now sell the
        // delivery standing in its own stockroom.
        $this->as($owner)->withHeaders(['X-Branch-Id' => $gulberg])->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $rice->id, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 2500,
        ])->assertCreated();

        // Tenant-wide on-hand is unchanged — this was always a question of
        // WHERE the twenty bags are, never how many there are.
        $this->assertEquals(19, $this->stockOf($rice->id));
        $this->assertEquals(0, (float) BranchStock::withoutTenancy()
            ->where('branch_id', $main->id)->where('product_id', $rice->id)->sum('quantity'));
    }

    // ── 8. Budgets against the same bills the cashbook counts ───────

    public function test_a_budget_and_the_cashbook_tell_the_same_story_about_the_same_bills(): void
    {
        // A ceiling is only useful if it is measured against the same rupees
        // the books count. Budget spend and cashbook expenses are computed by
        // two separate queries, so the interesting failure is them disagreeing
        // — an owner shown "within budget" on one screen and the overspend on
        // another has no way to tell which is lying.
        [$shop, $owner] = $this->shop();

        $wages = $this->as($owner)->postJson('/api/v1/expense-categories', ['name' => 'Wages'])
            ->assertCreated()->json('data.id');
        $power = $this->as($owner)->postJson('/api/v1/expense-categories', ['name' => 'Electricity'])
            ->assertCreated()->json('data.id');

        // Wages capped at 50,000 a month. Electricity deliberately left
        // uncapped: "no budget" and "a budget of zero" are different answers.
        $this->as($owner)->postJson('/api/v1/expenses/budgets', [
            'expense_category_id' => $wages, 'amount' => 50000,
        ])->assertOk()->assertJsonPath('data.amount', '50000.00');

        foreach ([['Loaders — week 1', 30000], ['Loaders — week 2', 25000]] as [$what, $amount]) {
            $this->as($owner)->postJson('/api/v1/expenses', [
                'expense_category_id' => $wages,
                'description' => $what,
                'amount' => $amount,
                'expense_date' => now()->toDateString(),
                'payment_method' => 'cash',
            ])->assertCreated();
        }

        $this->as($owner)->postJson('/api/v1/expenses', [
            'expense_category_id' => $power,
            'description' => 'K-Electric bill',
            'amount' => 18000,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'bank_transfer',
        ])->assertCreated();

        $rows = collect($this->as($owner)->getJson('/api/v1/expenses/budgets')
            ->assertOk()->json('data'))->keyBy('category');

        // 55,000 against a 50,000 ceiling — over by 5,000, and SAID to be over.
        $this->assertEquals(50000, $rows['Wages']['budget']);
        $this->assertEquals(55000, $rows['Wages']['spent'], 'The budget page is not counting the bills that were actually recorded.');
        $this->assertEquals(-5000, $rows['Wages']['remaining']);
        $this->assertTrue($rows['Wages']['over'], 'The month blew its ceiling and the page did not say so.');

        // Uncapped is null, not zero. Zero would read as "overspent by 18,000".
        $this->assertNull($rows['Electricity']['budget']);
        $this->assertEquals(18000, $rows['Electricity']['spent']);
        $this->assertNull($rows['Electricity']['remaining']);
        $this->assertFalse($rows['Electricity']['over']);

        // The far end: the same 73,000 of bills, counted by the cashbook. Note
        // the bank transfer counts as money out even though the drawer never
        // moved — the books are not the till.
        $today = collect($this->as($owner)->getJson('/api/v1/cashbook?'.http_build_query([
            'from' => now()->startOfMonth()->toDateString(),
            'to' => now()->endOfMonth()->toDateString(),
        ]))->assertOk()->json('data.days'))->firstWhere('date', now()->toDateString());

        $this->assertEquals(73000, $today['expenses'], 'The budget page and the cashbook disagree about the same bills.');
        $this->assertEquals(-73000, $today['net']);
    }

    // ── 9. The person axis: a cashier's reach ───────────────────────

    public function test_a_cashier_can_ring_a_sale_but_the_owners_reports_stay_shut(): void
    {
        // The person axis. A cashier hired off the preset must be able to do the
        // job — read the grid, ring the sale, take the money — without gaining
        // the owner's view of what the shop earns. Reads and writes are gated
        // separately, so "can sell" and "can see the margin" have to be checked
        // as two different questions.
        [$shop, $owner] = $this->shop();
        $rice = $this->product($shop, 'Basmati Rice 5kg', price: 2500, cost: 1800, stock: 20);

        $cashier = User::factory()
            ->tenantStaff($shop, StaffPresets::permissionsFor('cashier'))
            ->create();

        // The job itself: the grid loads and the sale goes through.
        $grid = $this->as($cashier)->getJson('/api/v1/products')->assertOk()->json('data');
        $this->assertSame($rice->id, $grid[0]['id'] ?? null, 'A cashier cannot see the shelf they sell from.');

        $this->as($cashier)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $rice->id, 'quantity' => 2]],
            'payment_method' => 'cash', 'amount_paid' => 5000,
        ])->assertCreated()->assertJsonPath('data.total', '5000.00');

        $this->assertEquals(18, $this->stockOf($rice->id), 'A cashier rang a sale and the shelf did not move.');

        // The owner's reports are shut: margins, valuation and dead stock all
        // sit behind reports.view, which no operational preset carries.
        $this->as($cashier)->getJson('/api/v1/reports/margins')->assertForbidden();
        $this->as($cashier)->getJson('/api/v1/reports/valuation')->assertForbidden();
        $this->as($cashier)->getJson('/api/v1/reports/summary')->assertForbidden();
        // Nor can they reprice what they sell.
        $this->as($cashier)->putJson("/api/v1/products/{$rice->id}", ['price' => 1])->assertForbidden();

        // And the buying price is not on the grid either. Fixed 2026-08-10: the
        // margin REPORT was already shut to a cashier, and the same figure was
        // walking out on the product list the till loads anyway — anyone
        // rostered on the counter could read what every item cost the shop and
        // work the margin out with a calculator.
        //
        // Masked in the HidesCostPrice concern rather than in this one
        // controller, because a product is serialised from a dozen places and a
        // rule enforced at one of them leaks from the other eleven.
        $this->assertArrayNotHasKey('cost', $grid[0], 'A cashier can still read the buying price.');
        // But `wholesale_price` stays. It is a SELLING price, and the till
        // reads it to offer the wholesale level — hiding it from the cashier
        // protects nothing and silently removes wholesale selling.
        $this->assertArrayHasKey('wholesale_price', $grid[0]);
        // The selling price is still there — the till cannot work without it.
        $this->assertEquals(2500, $grid[0]['price']);

        // The owner, who holds reports.view, still sees it.
        $ownerGrid = $this->as($owner)->getJson('/api/v1/products')->assertOk()->json('data');
        $this->assertEquals(1800, $ownerGrid[0]['cost'], 'Cost was hidden from someone entitled to it.');
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /**
     * A grocery with every module a mart is sold with. `branches` raises the
     * shop's own branch allowance (Main counts as one).
     *
     * @return array{0: Tenant, 1: User}
     */
    private function shop(int $branches = 1): array
    {
        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);

        $shop = Tenant::factory()->create([
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'timezone' => 'UTC',
            'plan_id' => Plan::query()->create([
                'name' => 'Walkthrough', 'code' => uniqid('plan_'), 'price' => 0,
                'billing_period_months' => 1, 'grace_period_days' => 7,
            ])->id,
            'limits' => ['branches' => $branches],
        ]);

        return [$shop, User::factory()->shopOwner($shop)->create()];
    }

    private function as(User $user): static
    {
        // Wipe any sticky X-Branch-Id from an earlier call — withHeaders()
        // persists across requests in the same test, and a leaked branch header
        // turns an "all branches" assertion into a focused one that happens to
        // agree.
        $this->defaultHeaders = [];
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function product(
        Tenant $shop,
        string $name,
        float $price,
        ?float $cost = null,
        float $stock = 0,
        ?float $threshold = null,
    ): Product {
        return Product::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'type' => 'product',
            'item_type' => 'physical_product',
            'name' => $name,
            'price' => $price,
            'cost' => $cost,
            'stock_quantity' => $stock,
            'low_stock_threshold' => $threshold,
            'track_inventory' => true,
        ]);
    }

    private function stockOf(string $productId): float
    {
        return (float) Product::withoutTenancy()->findOrFail($productId)->stock_quantity;
    }

    private function sell(User $owner, Product $product, float $qty): void
    {
        $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $product->id, 'quantity' => $qty]],
            'payment_method' => 'cash',
            'amount_paid' => $qty * (float) $product->price,
        ])->assertCreated();
    }

    /** @return array<int, string> product ids on the reorder list */
    private function reorderList(User $owner): array
    {
        return collect($this->as($owner)->getJson('/api/v1/inventory/low-stock')->assertOk()->json('data'))
            ->pluck('id')->all();
    }

    private function todaysRevenue(User $owner, ?string $branchId = null): float
    {
        $request = $this->as($owner);
        if ($branchId !== null) {
            $request = $request->withHeaders(['X-Branch-Id' => $branchId]);
        }

        $days = $request->getJson('/api/v1/cashbook?'.http_build_query([
            'from' => now()->toDateString(), 'to' => now()->toDateString(),
        ]))->assertOk()->json('data.days');

        return (float) collect($days)->firstWhere('date', now()->toDateString())['sales_revenue'];
    }
}
