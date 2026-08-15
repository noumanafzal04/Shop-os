<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Category;
use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductUnit;
use App\Models\ProductVariant;
use App\Models\Promotion;
use App\Models\TaxGroup;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The catalog a till holds, and how it stays current.
 *
 * Three properties carry the whole design and each has its own section below:
 *
 *  1. **The projection is a projection.** Cost never leaves the server. A
 *     device is a thing that gets stolen, lent out and handed to a stranger,
 *     and its browser storage is readable by whoever is holding it.
 *
 *  2. **The cursor is exact.** Thousands of rows share a timestamp when a CSV
 *     import writes them in one second, so a cursor of time alone either
 *     repeats a page forever or steps over the rest of it.
 *
 *  3. **Removal travels.** Products are soft-deleted and can be switched off,
 *     and neither shows up in a plain "changed since" query — so without
 *     tombstones an item a shop stopped selling stays sellable on every tablet
 *     that already has it, for good.
 */
class PosCatalogSyncTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $cashier;

    private Category $category;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->cashier = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();
        $this->category = Category::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Grocery', 'is_active' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function product(array $over = []): Product
    {
        return Product::query()->create(array_merge([
            'tenant_id' => $this->tenant->id,
            'category_id' => $this->category->id,
            'type' => 'product',
            'item_type' => 'physical_product',
            'name' => 'Milkpak 1L',
            'price' => 250,
            'cost' => 190,
            'track_inventory' => true,
            'stock_quantity' => 40,
            'is_active' => true,
        ], $over));
    }

    /** The whole first load — every projection at once. */
    private function bootstrap(): array
    {
        return $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/bootstrap')
            ->assertOk()->json('data');
    }

    /** Everything changed since a cursor, for ONE projection. */
    private function delta(string $type, ?string $cursor): array
    {
        $query = $cursor === null ? '' : '?'.$type.'='.urlencode($cursor);

        return $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/catalog'.$query)
            ->assertOk()->json("data.{$type}");
    }

    // ── 1. The projection is a projection ───────────────────────────

    public function test_the_buying_price_never_leaves_the_server(): void
    {
        // The single most important assertion in this file. A cashier cannot
        // read cost on screen; caching it would hand the whole margin sheet to
        // anyone who opens DevTools, and the shop's pricing book to whoever
        // picks the tablet up.
        $this->product();

        $item = $this->bootstrap()['products']['items'][0];

        // Checked against the decoded item and not the raw body. The body
        // carries UUIDs, and a UUID that happens to contain "190" made this
        // test fail on a build that had nothing to do with it — a check that
        // cries wolf gets deleted, and this is the one assertion in the file
        // that must never be.
        foreach (['cost', 'cost_price', 'avg_cost', 'purchase_price'] as $field) {
            $this->assertArrayNotHasKey($field, $item);
        }

        // And nothing else on the item quietly carries the figure either — a
        // renamed field would slip past a list of names.
        $this->assertNotContains(190, $item);
        $this->assertNotContains('190.00', $item);
    }

    public function test_it_carries_what_a_counter_needs_and_leaves_the_rest(): void
    {
        $group = TaxGroup::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Standard', 'rate' => 17, 'is_active' => true,
        ]);
        $this->product([
            'sku' => 'MLK-1', 'barcode' => '8964000000001', 'plu_code' => '4011',
            'discount_price' => 230, 'wholesale_price' => 220, 'tax_group_id' => $group->id,
            'sold_by' => 'weight', 'unit' => 'KG', 'low_stock_threshold' => 5,
            'description' => str_repeat('long marketing copy ', 200),
        ]);

        $item = $this->bootstrap()['products']['items'][0];

        foreach (['id', 'name', 'sku', 'barcode', 'plu_code', 'price', 'discount_price',
            'wholesale_price', 'tax_group_id', 'sold_by', 'unit', 'stock', 'offline_ok'] as $field) {
            $this->assertArrayHasKey($field, $item, "`{$field}` is missing from the till's catalog.");
        }

        // Absent on purpose: the largest column in the table, and search runs
        // on name, SKU, barcode and category instead.
        $this->assertArrayNotHasKey('cost', $item);
        $this->assertArrayNotHasKey('description', $item);
    }

    public function test_it_flattens_variants_packs_and_extra_barcodes(): void
    {
        // Everything a scanner can hit has to be in the projection, or a code
        // that resolves online resolves to nothing on a till.
        $product = $this->product(['barcode' => '8964000000001']);
        ProductVariant::query()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $product->id,
            'name' => 'Large', 'sku' => 'MLK-L', 'price' => 400, 'stock_quantity' => 7,
        ]);
        ProductUnit::query()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $product->id,
            'name' => 'Carton', 'factor' => 12, 'price' => 2800, 'barcode' => '8964000000002',
        ]);
        ProductBarcode::query()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $product->id,
            'barcode' => '8964000000003',
        ]);

        $item = $this->bootstrap()['products']['items'][0];

        $this->assertSame('Large', $item['variants'][0]['name']);
        $this->assertSame('Carton', $item['units'][0]['name']);
        $this->assertSame('8964000000002', $item['units'][0]['barcode']);
        $this->assertSame(['8964000000003'], $item['barcodes']);
    }

    public function test_stock_is_this_branch_only(): void
    {
        // A till sells from where it stands. Another branch's shelf is not its
        // shelf, and showing the sum would tell a cashier they have stock they
        // cannot reach.
        $product = $this->product();
        $main = Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)
            ->where('is_default', true)->first();
        $other = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Second', 'is_default' => false,
        ]);
        BranchStock::withoutTenancy()->where('product_id', $product->id)->delete();
        BranchStock::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $main->id,
            'product_id' => $product->id, 'variant_id' => null, 'quantity' => 12,
        ]);
        BranchStock::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $other->id,
            'product_id' => $product->id, 'variant_id' => null, 'quantity' => 999,
        ]);

        $this->assertEquals(12, $this->bootstrap()['products']['items'][0]['stock']);
    }

    public function test_it_marks_what_a_till_may_not_sell_without_the_server(): void
    {
        // The allow-list rides on the ITEM, not the trade: a pharmacy sells
        // shampoo, and a trade-shaped rule would forbid its whole counter.
        $plain = $this->product(['name' => 'Soap', 'sku' => 'SOAP']);
        $serial = $this->product(['name' => 'Phone', 'sku' => 'PH-1', 'tracks_serial' => true]);

        $items = collect($this->bootstrap()['products']['items'])->keyBy('id');

        $this->assertTrue($items[$plain->id]['offline_ok']);
        $this->assertFalse($items[$serial->id]['offline_ok'], 'Two tills would sell the same IMEI.');
    }

    public function test_a_medicine_is_never_offline_sellable(): void
    {
        $pharmacy = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'pharmacy',
            'features' => BusinessTypes::defaultFeatures('pharmacy'),
        ]);
        $chemist = User::factory()->tenantStaff($pharmacy, ['sales.manage'])->create();
        Product::query()->create([
            'tenant_id' => $pharmacy->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Panadol', 'price' => 50, 'track_inventory' => true, 'is_active' => true,
        ]);

        $items = $this->actingAsUser($chemist)->getJson('/api/v1/pos/bootstrap')
            ->assertOk()->json('data.products.items');

        // Live batch quantities, FEFO order and the expiry fence. Selling
        // expired stock offline is a regulatory event, not a bug report.
        $this->assertFalse($items[0]['offline_ok']);
    }

    public function test_the_first_load_carries_what_it_needs_to_price_a_line(): void
    {
        // A till holding the catalog but not the tax rate cannot price
        // anything, so two calls would leave a window where it has one and not
        // the other.
        TaxGroup::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Standard', 'rate' => 17, 'is_active' => true,
        ]);
        $data = $this->bootstrap();

        $this->assertEquals(17, $data['tax_groups']['items'][0]['rate']);
        $this->assertArrayHasKey('default_tax_rate', $data['settings']);
        $this->assertArrayHasKey('cash_rounding', $data['settings']);
        $this->assertSame(3, $data['offline_days']);
        $this->assertNotNull($data['server_time']);
    }

    // ── The kill switch ─────────────────────────────────────────────
    //
    // It rides the catalog because that is the one call a till makes WHILE IT
    // STILL HAS a connection — the only moment the answer can change hands.

    public function test_a_shop_is_not_allowed_to_sell_offline_until_it_is_granted(): void
    {
        // Off by default. A shop earns offline selling once shadow mode has
        // proved the pricing mirror on ITS OWN carts, and an admin turns it on
        // — never by installing the software.
        $this->assertFalse($this->bootstrap()['offline_selling']);
    }

    public function test_an_admin_can_grant_offline_selling(): void
    {
        $this->tenant->update(['limits' => ['offline_selling' => 1]]);

        $this->assertTrue($this->bootstrap()['offline_selling']);
    }

    public function test_turning_it_off_again_reaches_the_till(): void
    {
        // The kill switch half. It stops NEW offline sales; it is never a
        // reason to reject one already queued — that is PosSyncController's
        // rule and it does not consult this at all.
        $this->tenant->update(['limits' => ['offline_selling' => 1]]);
        $this->assertTrue($this->bootstrap()['offline_selling']);

        $this->tenant->update(['limits' => ['offline_selling' => 0]]);

        $this->assertFalse($this->bootstrap()['offline_selling']);
    }

    public function test_the_shop_cannot_switch_it_on_from_its_own_settings(): void
    {
        // It is a LIMIT, not a setting, precisely so the shop cannot. Settings
        // are written through the shop's own form; limits are the admin's
        // decision about this particular shop, on the same axis as branches
        // and staff.
        $this->tenant->update(['settings' => ['offline_selling' => true]]);

        $this->assertFalse($this->bootstrap()['offline_selling']);
    }

    // ── The shop's own ceiling on trading blind (P3-17) ─────────────
    //
    // `offline_days` MARKS a sale for the owner to look at afterwards. This
    // REFUSES to start a new one, and the two are different tools for a reason:
    // at some depth a flag stops being information and the shop is simply
    // guessing at prices, stock and offers from a catalog nobody has updated.

    public function test_a_shop_has_no_hard_stop_unless_it_asked_for_one(): void
    {
        // Zero — never stop. A ceiling nobody chose would close a counter over
        // a decision this software made on the shop's behalf.
        $this->assertSame(0, $this->bootstrap()['offline_hard_stop_days']);
    }

    public function test_a_hard_stop_reaches_the_till_that_has_to_enforce_it(): void
    {
        // It rides the catalog for the same reason the kill switch does: that
        // is the one call a till makes while it still HAS a connection, which
        // is the only moment the answer can change hands.
        $this->tenant->update(['limits' => ['offline_hard_stop_days' => 5]]);

        $this->assertSame(5, $this->bootstrap()['offline_hard_stop_days']);
    }

    public function test_lifting_a_hard_stop_reaches_the_till_too(): void
    {
        // A shop that turned one on during Ramadan and wants it gone in March.
        // Half a switch is worse than none — the tills that took it would go on
        // refusing sales against a rule nobody is enforcing any more.
        $this->tenant->update(['limits' => ['offline_hard_stop_days' => 5]]);
        $this->assertSame(5, $this->bootstrap()['offline_hard_stop_days']);

        $this->tenant->update(['limits' => ['offline_hard_stop_days' => 0]]);

        $this->assertSame(0, $this->bootstrap()['offline_hard_stop_days']);
    }

    public function test_the_shop_cannot_set_its_own_ceiling_from_its_settings(): void
    {
        // The same reason as the kill switch: settings are written through the
        // shop's own form, and this is an owner-and-admin decision that sits
        // beside branches and staff.
        $this->tenant->update(['settings' => ['offline_hard_stop_days' => 2]]);

        $this->assertSame(0, $this->bootstrap()['offline_hard_stop_days']);
    }

    // ── What a till needs to price a promotion itself ───────────────
    //
    // The first real shadow run found nine carts where the server applied a
    // 10% promotion and the till applied nothing. The till now mirrors the
    // promotion engine — and it cannot, unless every field that decides one
    // actually reaches it.

    public function test_switching_a_promotion_of_f_removes_it_from_every_till(): void
    {
        // Not "sent with a flag" — REMOVED. The catalog is a delta, and a
        // deactivated promotion travels as a tombstone, exactly as a deleted
        // one does. That is the stronger of the two mechanisms: a till cannot
        // apply an offer it no longer holds.
        //
        // Absence would be the failure. The delta only carries what CHANGED,
        // so a promotion that simply stopped appearing would sit on every
        // tablet for ever, discounting every cart against the owner's own
        // decision to stop it.
        $live = Promotion::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Weekend 10% Off',
            'type' => 'percent', 'value' => 10, 'scope' => 'order', 'is_active' => true,
        ]);

        $first = $this->bootstrap()['promotions'];
        $this->assertSame($live->id, $first['items'][0]['id']);
        $this->assertTrue($first['items'][0]['is_active']);

        // Past the cursor's second, or the delta reads it as already seen —
        // the cursor is `updated_at|id` and a change inside the same second
        // is not "after" it.
        $this->travel(1)->minutes();
        $live->update(['is_active' => false]);

        $row = collect($this->delta('promotions', $first['cursor'])['items'])
            ->firstWhere('id', $live->id);

        $this->assertNotNull($row, 'Switching a promotion off must reach the till.');
        $this->assertTrue($row['deleted'] ?? false, 'It has to arrive as a removal.');
    }

    public function test_a_till_is_told_the_buy_and_get_quantities(): void
    {
        // Without these a till cannot tell a BOGO it understands from one it
        // does not, and guessing at a promotion is how a receipt goes wrong.
        $bogo = Promotion::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Buy 2 get 1',
            'type' => 'bogo', 'value' => 0, 'scope' => 'order', 'is_active' => true,
            'buy_qty' => 2, 'get_qty' => 1, 'get_discount_pct' => 50,
        ]);

        $row = collect($this->bootstrap()['promotions']['items'])->firstWhere('id', $bogo->id);

        $this->assertEqualsWithDelta(2.0, $row['buy_qty'], 0.001);
        $this->assertEqualsWithDelta(1.0, $row['get_qty'], 0.001);
        $this->assertEqualsWithDelta(50.0, $row['get_discount_pct'], 0.001);
    }

    public function test_a_till_is_told_the_shops_own_timezone(): void
    {
        // A promotion that runs on Fridays, or between 6pm and 9pm, is a
        // statement about LOCAL time. Judged in UTC it would open a Karachi
        // shop's evening sale five hours early and close it five hours early.
        $this->tenant->update(['timezone' => 'Asia/Karachi']);

        $this->assertSame('Asia/Karachi', $this->bootstrap()['timezone']);
    }

    public function test_the_first_load_does_not_leak_the_rest_of_the_shops_settings(): void
    {
        $data = $this->bootstrap();

        // Delivery radius, loyalty rates, kitchen stations — none of it is
        // counter information, and every extra field is another thing on a
        // stolen tablet.
        $this->assertArrayNotHasKey('delivery_radius_km', $data['settings']);
        $this->assertArrayNotHasKey('loyalty_earn_per_amount', $data['settings']);
    }

    // ── 2. The cursor is exact ──────────────────────────────────────

    public function test_a_delta_returns_only_what_changed(): void
    {
        $this->product(['name' => 'First', 'sku' => 'A']);
        $cursor = $this->bootstrap()['products']['cursor'];

        $this->assertSame([], $this->delta('products', $cursor)['items']);

        $this->travel(1)->second();
        $this->product(['name' => 'Second', 'sku' => 'B']);

        $items = $this->delta('products', $cursor)['items'];
        $this->assertCount(1, $items);
        $this->assertSame('Second', $items[0]['name']);
    }

    public function test_a_cursor_resumes_insid_e_a_run_of_rows_sharing_one_timestamp(): void
    {
        // The reason the cursor carries an id as well as a time, and the only
        // shape that proves it. A CSV import writes thousands of rows inside
        // one second; if a page ever ends part-way through that second, a
        // cursor of time alone must either replay the whole second forever or
        // step over everything left in it. Here the cursor is placed ON the
        // first of five tied rows — exactly where a page boundary would leave
        // it — and the other four have to come back.
        $stamp = now()->subMinute();
        $ids = [];
        for ($i = 0; $i < 5; $i++) {
            $product = $this->product(['name' => "Same {$i}", 'sku' => "S{$i}"]);
            $product->forceFill(['updated_at' => $stamp])->saveQuietly();
            $ids[] = $product->id;
        }
        sort($ids); // the order the endpoint pages in: updated_at, then id

        // Formatted exactly as the column stores it — see the endpoint's
        // encode(), where a mismatched precision compares differently on
        // SQLite and MySQL.
        $cursor = $stamp->format((new Product)->getDateFormat()).'|'.$ids[0];

        $returned = collect($this->delta('products', $cursor)['items'])->pluck('id')->sort()->values()->all();

        $this->assertSame(array_slice($ids, 1), $returned,
            'Rows sharing a timestamp were lost when the cursor landed in the middle of them.');
    }

    public function test_a_row_written_in_the_cursors_own_second_still_arrives(): void
    {
        // This is the everyday case, not an edge one: two products saved a
        // moment apart share a second, and `timestamps()` stores one-second
        // resolution. It uses the ENDPOINT's own cursor rather than building
        // one, which is what makes it the test that catches a cursor formatted
        // at a precision the column does not hold — a mismatch that compares
        // differently on SQLite and MySQL and would therefore pass CI and fail
        // in a shop.
        // Frozen, so "the same second" is a fact rather than a coincidence —
        // unfrozen, this test would pass except when a tick fell between the
        // two writes, which is the worst kind of flake: rare, and green.
        $this->freezeTime();

        $first = $this->product(['name' => 'First', 'sku' => 'A']);
        $cursor = $this->bootstrap()['products']['cursor'];

        $second = $this->product(['name' => 'Second', 'sku' => 'B']);
        $this->assertSame($first->updated_at->format('Y-m-d H:i:s'), $second->updated_at->format('Y-m-d H:i:s'),
            'This test is meaningless unless both rows really do share a second.');
        // The tie-break pages by (updated_at, id), so it relies on ids rising
        // with time. Laravel mints ordered UUIDs; assert it rather than trust it.
        $this->assertGreaterThan($first->id, $second->id, 'Ordered UUIDs are what make the tie-break total.');

        $items = $this->delta('products', $cursor)['items'];

        $this->assertCount(1, $items, 'A product saved in the cursor\'s own second was lost.');
        $this->assertSame('Second', $items[0]['name']);
    }

    public function test_a_nonsense_cursor_resyncs_rather_than_failing(): void
    {
        // A cursor is client-supplied. A full resync is slow; a dead till is
        // worse.
        $this->product();

        $data = $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/catalog?products='.urlencode('not-a-cursor'))
            ->assertOk()->json('data.products');

        $this->assertCount(1, $data['items']);
    }

    public function test_it_says_when_there_is_another_page(): void
    {
        $data = $this->bootstrap()['products'];

        // One small shop fits in a page; the flag is what stops a client
        // stopping early on a large one.
        $this->assertFalse($data['has_more']);
        $this->assertArrayHasKey('cursor', $data);
    }

    // ── 3. Removal travels ──────────────────────────────────────────

    public function test_a_deleted_product_arrives_as_a_tombstone(): void
    {
        // Without this the item stays sellable on every device that already
        // holds it — not for a while, but for good.
        $product = $this->product();
        $cursor = $this->bootstrap()['products']['cursor'];

        $this->travel(1)->second();
        $product->delete();

        $items = $this->delta('products', $cursor)['items'];

        $this->assertCount(1, $items);
        $this->assertSame($product->id, $items[0]['id']);
        $this->assertTrue($items[0]['deleted']);
        // A tombstone is an instruction to forget, so it carries nothing else.
        $this->assertArrayNotHasKey('price', $items[0]);
    }

    public function test_switching_a_product_off_also_takes_it_off_the_till(): void
    {
        // Deleted and retired are different things to a shopkeeper and the same
        // thing to a counter: neither may be rung up.
        $product = $this->product();
        $cursor = $this->bootstrap()['products']['cursor'];

        $this->travel(1)->second();
        $product->update(['is_active' => false]);

        $items = $this->delta('products', $cursor)['items'];

        $this->assertTrue($items[0]['deleted'] ?? false,
            'A retired product must leave the till the same way a deleted one does.');
    }

    public function test_switching_it_back_on_brings_it_back(): void
    {
        $product = $this->product(['is_active' => false]);
        $cursor = $this->bootstrap()['products']['cursor'];

        $this->travel(1)->second();
        $product->update(['is_active' => true]);

        $items = $this->delta('products', $cursor)['items'];

        $this->assertArrayNotHasKey('deleted', $items[0]);
        $this->assertSame('Milkpak 1L', $items[0]['name']);
    }

    // ── Everything else a till holds, not just products ─────────────
    //
    // A till that only learns about products goes quietly wrong: the shop
    // renames a category and the counter shows the old one, a promotion made on
    // Monday never runs, a corrected tax rate leaves every receipt wrong. The
    // change WAS saved — it just never travelled, which is worse than a loud
    // failure because nothing on the shop's side looks broken.

    public function test_a_new_category_reaches_the_till(): void
    {
        $cursor = $this->bootstrap()['categories']['cursor'];

        $this->travel(1)->second();
        Category::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Bakery', 'is_active' => true,
        ]);

        $items = $this->delta('categories', $cursor)['items'];

        $this->assertCount(1, $items);
        $this->assertSame('Bakery', $items[0]['name']);
    }

    public function test_a_renamed_category_reaches_the_till(): void
    {
        $cursor = $this->bootstrap()['categories']['cursor'];

        $this->travel(1)->second();
        $this->category->update(['name' => 'Groceries & Dairy']);

        $this->assertSame('Groceries & Dairy', $this->delta('categories', $cursor)['items'][0]['name']);
    }

    public function test_a_hidden_category_is_tombstoned(): void
    {
        $cursor = $this->bootstrap()['categories']['cursor'];

        $this->travel(1)->second();
        $this->category->update(['is_active' => false]);

        $this->assertTrue($this->delta('categories', $cursor)['items'][0]['deleted'] ?? false);
    }

    public function test_a_new_promotion_reaches_the_till_with_its_window(): void
    {
        $cursor = $this->bootstrap()['promotions']['cursor'];

        $this->travel(1)->second();
        Promotion::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Ramzan 10%',
            'type' => 'percent', 'value' => 10, 'scope' => 'order',
            'min_spend' => 1000, 'priority' => 5, 'is_active' => true,
            'starts_on' => '2026-03-01', 'ends_on' => '2026-03-30',
        ]);

        $promo = $this->delta('promotions', $cursor)['items'][0];

        $this->assertSame('Ramzan 10%', $promo['name']);
        $this->assertEquals(10, $promo['value']);
        $this->assertEquals(1000, $promo['min_spend']);
        // The window travels: a till running a sale that ended is worse than a
        // till not running one that started.
        $this->assertSame('2026-03-01', $promo['starts_on']);
        $this->assertSame('2026-03-30', $promo['ends_on']);
    }

    public function test_a_switched_off_promotion_is_tombstoned(): void
    {
        $promo = Promotion::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Old sale',
            'type' => 'percent', 'value' => 10, 'scope' => 'order', 'is_active' => true,
        ]);
        $cursor = $this->bootstrap()['promotions']['cursor'];

        $this->travel(1)->second();
        $promo->update(['is_active' => false]);

        // Without this a till keeps discounting after the shop stopped.
        $this->assertTrue($this->delta('promotions', $cursor)['items'][0]['deleted'] ?? false);
    }

    public function test_a_corrected_tax_rate_reaches_the_till(): void
    {
        $group = TaxGroup::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Standard', 'rate' => 17, 'is_active' => true,
        ]);
        $cursor = $this->bootstrap()['tax_groups']['cursor'];

        $this->travel(1)->second();
        $group->update(['rate' => 18]);

        // Every receipt is wrong until this lands.
        $this->assertEquals(18, $this->delta('tax_groups', $cursor)['items'][0]['rate']);
    }

    public function test_a_customer_group_carries_what_pricing_needs(): void
    {
        $cursor = $this->bootstrap()['customer_groups']['cursor'];

        $this->travel(1)->second();
        CustomerGroup::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Trade',
            'price_level' => 'wholesale', 'discount_percent' => 5, 'is_active' => true,
        ]);

        $group = $this->delta('customer_groups', $cursor)['items'][0];

        // A cart cannot be priced without these two.
        $this->assertSame('wholesale', $group['price_level']);
        $this->assertEquals(5, $group['discount_percent']);
    }

    public function test_a_customer_arrives_as_a_name_and_a_phone_and_nothing_else(): void
    {
        $cursor = $this->bootstrap()['customers']['cursor'];

        $this->travel(1)->second();
        Customer::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Ahmed', 'phone' => '03001234567',
        ]);

        $customer = $this->delta('customers', $cursor)['items'][0];

        $this->assertSame('Ahmed', $customer['name']);
        $this->assertSame('03001234567', $customer['phone']);
        // A balance or a ledger in browser storage is a customer's private
        // business sitting on a tablet that gets lent out.
        $this->assertArrayNotHasKey('balance', $customer);
        $this->assertArrayNotHasKey('credit_limit', $customer);
        $this->assertArrayNotHasKey('email', $customer);
        $this->assertArrayNotHasKey('address', $customer);
    }

    public function test_settings_ride_on_every_delta_not_only_the_first_load(): void
    {
        // Withholding them until the next cold start is how a discount ceiling
        // raised on Monday is still not being enforced on Friday.
        $this->tenant->forceFill(['settings' => ['max_discount_percent' => 25]])->save();

        $data = $this->actingAsUser($this->cashier)->getJson('/api/v1/pos/catalog')
            ->assertOk()->json('data');

        $this->assertEquals(25, $data['settings']['max_discount_percent']);
        $this->assertSame(3, $data['offline_days']);
    }

    public function test_each_projection_pages_on_its_own_cursor(): void
    {
        // One shared cursor would make a category rename wait behind a
        // 20,000-item catalog's twenty requests.
        $data = $this->bootstrap();

        foreach (['products', 'categories', 'promotions', 'tax_groups', 'customer_groups', 'customers'] as $type) {
            $this->assertArrayHasKey('items', $data[$type], "{$type} is missing from the till's world.");
            $this->assertArrayHasKey('cursor', $data[$type], "{$type} cannot resume without a cursor.");
            $this->assertArrayHasKey('has_more', $data[$type]);
        }
    }

    public function test_one_projections_cursor_does_not_move_another(): void
    {
        $this->product();
        $data = $this->bootstrap();

        // Ask for product changes only. Categories must come back untouched and
        // still resumable from where they were.
        $after = $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/catalog?products='.urlencode($data['products']['cursor']))
            ->assertOk()->json('data');

        $this->assertSame([], $after['products']['items']);
        // No categories cursor was sent, so it reads from the beginning —
        // proving the two are independent rather than sharing one position.
        $this->assertCount(1, $after['categories']['items']);
    }

    // ── Applying a page twice must be safe ──────────────────────────

    public function test_the_same_page_asked_for_twice_is_identical(): void
    {
        // A till whose write failed re-asks with the SAME cursor. If the answer
        // drifted between the two calls the retry would apply something
        // different from what was refused, so the endpoint has to be a pure
        // function of (cursor, current state) — never of how many times it has
        // been called.
        $this->product(['name' => 'Milk', 'sku' => 'A']);
        $this->product(['name' => 'Bread', 'sku' => 'B']);

        $first = $this->bootstrap()['products'];
        $again = $this->bootstrap()['products'];

        $this->assertSame($first['items'], $again['items']);
        $this->assertSame($first['cursor'], $again['cursor']);
    }

    public function test_an_empty_page_leaves_the_cursor_exactly_where_it_was(): void
    {
        // Moving it would claim progress that was not made. A till that then
        // failed to write would resume PAST rows it never received.
        $this->product();
        $cursor = $this->bootstrap()['products']['cursor'];

        $page = $this->delta('products', $cursor);

        $this->assertSame([], $page['items']);
        $this->assertSame($cursor, $page['cursor']);
    }

    public function test_replaying_an_older_cursor_re_sends_rather_than_skips(): void
    {
        // The recovery path. A till that lost its last write rewinds to the
        // cursor it knows it committed, and everything after it has to come
        // back — a delta that only ever moves forward could not be recovered
        // from at all.
        $this->product(['name' => 'First', 'sku' => 'A']);
        $old = $this->bootstrap()['products']['cursor'];

        $this->travel(1)->second();
        $this->product(['name' => 'Second', 'sku' => 'B']);
        $this->travel(1)->second();
        $this->product(['name' => 'Third', 'sku' => 'C']);

        $names = collect($this->delta('products', $old)['items'])->pluck('name')->all();

        $this->assertSame(['Second', 'Third'], $names);
        // And again, unchanged — replay is not consumption.
        $this->assertSame($names, collect($this->delta('products', $old)['items'])->pluck('name')->all());
    }

    // ── Gating ──────────────────────────────────────────────────────

    public function test_it_needs_the_pos_module_and_the_permission_to_sell(): void
    {
        $noSale = User::factory()->tenantStaff($this->tenant, ['products.manage'])->create();

        $this->actingAsUser($noSale)->getJson('/api/v1/pos/bootstrap')->assertForbidden();
        $this->actingAsUser($noSale)->getJson('/api/v1/pos/catalog')->assertForbidden();
    }
}
