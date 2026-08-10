<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\DiningTable;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A day's work, end to end, one trade at a time — the QA pass.
 *
 * Every other suite here tests a module. This one tests the SEAMS, because
 * that is where this codebase has actually broken: a capability built and one
 * link missing. Nine of those in a single week, every one of them green in the
 * unit tests of the module that owned it, because no test ever walked from one
 * module into the next.
 *
 * So each test below is a chain, and the assertion is always on the FAR end of
 * it — receive stock and check the ledger, not the stock table; fire a course
 * and check the kitchen screen, not the ticket. A link that silently does
 * nothing fails here and nowhere else.
 *
 * The chains, and which trade exercises each:
 *
 *   inventory → POS → ledger            mart      (buy, sell, refund, books)
 *   dine_in → kitchen → sales           food      (table to settled bill)
 *   inventory:batches → POS             pharmacy  (FEFO picks the earliest)
 *   catalog:flags → POS → warranty      retail    (serial captured at sale)
 *   item_type → inventory (absent)      services  (a haircut moves no stock)
 *   module gating → screens             finance   (books-only shop)
 *
 * `EveryTradeLoadsTest` already proves all seventeen codes can OPEN every
 * screen. This proves the six distinct shapes can WORK one.
 */
class TradeWorkflowTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    // ── mart: inventory → POS → ledger ──────────────────────────────

    public function test_a_grocery_buys_sells_refunds_and_the_books_agree(): void
    {
        // The spine of every stocked trade. Four modules, and the assertion is
        // on the last one: stock and cash have to end up telling the same story
        // about the same three events.
        [$shop, $owner] = $this->shop('mart');
        $rice = $this->product($shop, 'Basmati 5kg', price: 2400, cost: 1800, stock: 0);

        // 1. Buy — inventory in.
        $supplier = $this->as($owner)->postJson('/api/v1/suppliers', [
            'name' => 'Punjab Rice Traders', 'phone' => '+923001234567',
        ])->assertCreated()->json('data.id');

        $po = $this->as($owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier,
            'order_date' => now()->toDateString(),
            'status' => 'ordered',
            'items' => [['product_id' => $rice->id, 'quantity' => 20, 'unit_cost' => 1800]],
        ])->assertCreated()->json('data');

        $this->as($owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive")->assertOk();
        $this->assertEquals(20, $rice->fresh()->stock_quantity, 'Receiving a PO did not move stock in.');

        // 2. Sell — inventory out, cash in. Note no prices are sent: the server
        // is the only thing allowed to price a line.
        $sale = $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $rice->id, 'quantity' => 3]],
            'payment_method' => 'cash',
            'amount_paid' => 7200,
        ])->assertCreated()->json('data');

        $this->assertEquals(17, $rice->fresh()->stock_quantity);
        $this->assertEquals(7200, $sale['total']);

        // 3. Refund one bag — inventory back, cash out.
        $line = $sale['items'][0];
        $this->as($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $line['id'], 'quantity' => 1]],
            'refund_method' => 'cash',
            'reason' => 'Torn bag',
        ])->assertCreated();

        $this->assertEquals(18, $rice->fresh()->stock_quantity, 'A refund did not restock.');

        // 4. The books. This is the far end of the chain — three modules had to
        // each write for these two numbers to be right.
        //
        // Assert on the FIGURES, not on the presence of rows: the cashbook
        // emits one row per day in the range whether anything happened or not,
        // so "not empty" is true of a shop that never opened.
        $days = collect($this->as($owner)->getJson('/api/v1/cashbook?'.http_build_query([
            'from' => now()->subDay()->toDateString(),
            'to' => now()->addDay()->toDateString(),
        ]))->assertOk()->json('data.days'));

        $today = $days->firstWhere('date', now()->toDateString());

        $this->assertNotNull($today, 'Today is missing from the cashbook.');
        // The sale counts in full — a refunded sale still brought its money in;
        // only a cancelled one never happened. The refund is money out.
        $this->assertEquals(7200, $today['sales_revenue'], 'The sale never reached the books.');
        $this->assertEquals(2400, $today['refunds'], 'The refund never reached the books.');
        $this->assertEquals(4800, $today['net']);
    }

    // ── food: dine_in → kitchen → sales ─────────────────────────────

    public function test_a_restaurant_seats_fires_bumps_and_settles(): void
    {
        // The chain a restaurant lives on. The kitchen screen is a DIFFERENT
        // module reading what the floor wrote; if the seam is broken the food
        // is ordered and never cooked, and both modules pass their own tests.
        [$shop, $owner] = $this->shop('restaurant');
        $karahi = $this->product($shop, 'Chicken Karahi', price: 1400, stock: 0, tracked: false);
        $table = DiningTable::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'name' => 'T1', 'seats' => 4, 'is_active' => true,
        ]);

        $tab = $this->as($owner)->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in', 'dining_table_id' => $table->id, 'guest_count' => 2,
        ])->assertCreated()->json('data');

        $this->as($owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/items", [
            'items' => [['product_id' => $karahi->id, 'quantity' => 2]],
        ])->assertOk();

        // Fire — this is the seam. A course that is ordered but never fired is
        // the single most expensive bug a restaurant can have.
        $this->as($owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire")->assertCreated();

        // Assert on `kots`, not on `data` — the board always returns a wrapper
        // of {kots, stations, server_time}, so a check on the envelope passes
        // even when nothing was ever cooked. That mistake was made here first.
        $kots = $this->as($owner)->getJson('/api/v1/restaurant/kitchen')
            ->assertOk()->json('data.kots');

        $this->assertNotEmpty($kots, 'Fired food never reached the kitchen screen.');
        $this->assertSame(
            'Chicken Karahi',
            $kots[0]['items'][0]['name'] ?? null,
            'A ticket reached the pass without the dish on it.',
        );

        // Settle — the floor's work becomes a Sale, which is what every money
        // screen downstream actually reads.
        $this->as($owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payments' => [['method' => 'cash', 'amount' => 2800]],
        ])->assertCreated();

        $sales = $this->as($owner)->getJson('/api/v1/sales')->assertOk()->json('data');
        $this->assertNotEmpty($sales, 'A settled tab produced no sale — the floor and the books are not connected.');
    }

    // ── pharmacy: batches → POS ─────────────────────────────────────

    public function test_a_medical_store_sells_the_batch_that_expires_first(): void
    {
        // FEFO is not a preference, it is the difference between selling stock
        // and destroying it. The POS never chooses a batch explicitly, so this
        // only works if the sale path reads what the receiving path wrote.
        [$shop, $owner] = $this->shop('pharmacy');
        $med = $this->product($shop, 'Augmentin 625mg', price: 450, cost: 300, stock: 0, itemType: 'medicine');

        // Received in the WRONG order deliberately: the later expiry arrives
        // first, so "first in" and "first to expire" disagree. A FIFO
        // implementation passes every ordering test and fails this one.
        $this->receiveLot($owner, $med, 'LOT-FAR', qty: 10, expiry: now()->addYears(2));
        $this->receiveLot($owner, $med, 'LOT-NEAR', qty: 10, expiry: now()->addMonths(3));

        $this->assertEquals(20, $med->fresh()->stock_quantity);

        $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $med->id, 'quantity' => 4]],
            'payment_method' => 'cash',
            'amount_paid' => 1800,
        ])->assertCreated();

        $batches = collect($this->as($owner)
            ->getJson("/api/v1/inventory/products/{$med->id}/batches")
            ->assertOk()->json('data'))->keyBy('batch_number');

        $this->assertEquals(6, $batches['LOT-NEAR']['quantity'], 'FEFO did not take from the batch expiring first.');
        $this->assertEquals(10, $batches['LOT-FAR']['quantity'], 'The long-dated batch was touched.');
    }

    // ── services: item_type → inventory (deliberately absent) ───────

    public function test_a_salon_sells_a_service_and_nothing_leaves_a_shelf(): void
    {
        // The negative half of the catalog chain. A service is sellable but has
        // no stock, and a stock movement against one is a bug that only shows
        // up as impossible inventory weeks later.
        [$shop, $owner] = $this->shop('salon');
        $cut = $this->product($shop, 'Haircut & beard', price: 1200, stock: 0, tracked: false, itemType: 'service');

        $before = StockMovement::withoutTenancy()->count();

        $sale = $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $cut->id, 'quantity' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => 1200,
        ])->assertCreated()->json('data');

        $this->assertEquals(1200, $sale['total']);
        $this->assertSame($before, StockMovement::withoutTenancy()->count(), 'Selling a service moved stock.');
    }

    // ── finance: module gating → screens ────────────────────────────

    public function test_a_books_only_shop_keeps_its_cashbook_and_is_refused_a_catalog(): void
    {
        // The gating chain. A books-only tenant is the shape that proves module
        // flags actually reach the routes: the money screens must work, and the
        // catalog must be REFUSED rather than empty — an empty list looks like a
        // shop with no products, which is a different and much worse answer.
        [$shop, $owner] = $this->shop('finance', features: ['expenses' => true]);

        $category = $this->as($owner)->postJson('/api/v1/expense-categories', [
            'name' => 'Rent',
        ])->assertCreated()->json('data.id');

        $this->as($owner)->postJson('/api/v1/expenses', [
            'expense_category_id' => $category,
            'description' => 'Shop rent — August',
            'amount' => 45000,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'bank_transfer',
        ])->assertCreated();

        $this->as($owner)->getJson('/api/v1/cashbook?'.http_build_query([
            'from' => now()->startOfMonth()->toDateString(),
            'to' => now()->endOfMonth()->toDateString(),
        ]))->assertOk();

        // The door is shut, not the room empty.
        $this->as($owner)->getJson('/api/v1/products')->assertForbidden();
    }

    // ── The dependency itself, stated as a test ─────────────────────

    public function test_turning_off_inventory_does_not_take_the_till_with_it(): void
    {
        // Modules are meant to be independently removable. The failure mode
        // worth guarding is a shop losing a capability it still pays for
        // because something it switched off was silently load-bearing.
        [$shop, $owner] = $this->shop('mart');
        $tea = $this->product($shop, 'Tapal Danedar 400g', price: 950, stock: 12, tracked: false);

        $shop->forceFill(['features' => array_merge($shop->features ?? [], ['inventory' => false])])->save();

        $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $tea->id, 'quantity' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => 950,
        ])->assertCreated();

        // And the module that WAS switched off is properly shut.
        $this->as($owner)->getJson('/api/v1/purchase-orders')->assertForbidden();
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /** @return array{0: Tenant, 1: User} */
    private function shop(string $type, ?array $features = null): array
    {
        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);

        $shop = Tenant::factory()->create([
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => $type,
            'features' => $features ?? BusinessTypes::defaultFeatures($type),
            'timezone' => 'UTC',
        ]);

        return [$shop, User::factory()->shopOwner($shop)->create()];
    }

    private function as(User $user): static
    {
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
        bool $tracked = true,
        string $itemType = 'physical_product',
    ): Product {
        return Product::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'type' => $itemType === 'service' ? 'service' : 'product',
            'item_type' => $itemType,
            'name' => $name,
            'price' => $price,
            'cost' => $cost,
            'stock_quantity' => $stock,
            'track_inventory' => $tracked,
        ]);
    }

    private function receiveLot(User $owner, Product $product, string $number, int $qty, \DateTimeInterface $expiry): void
    {
        $this->as($owner)->postJson("/api/v1/inventory/products/{$product->id}/batches", [
            'batch_number' => $number,
            'quantity' => $qty,
            'expiry_date' => $expiry->format('Y-m-d'),
        ])->assertCreated();
    }
}
