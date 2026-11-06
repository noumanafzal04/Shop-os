<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\City;
use App\Models\Product;
use App\Models\Sale;
use App\Models\StockCountItem;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * A BRANCH SELLS WHAT IT LISTS — every surface that offers, rings, counts or
 * receives an item, asked the same question (v2).
 *
 * AnItemIsListedAtItsBranchesTest holds the rules of WHO lists WHERE. This one
 * holds the consequences: the till, the sale, the offline catalogue, the
 * quote, the reorder list, the count sheet, the transfer, the import — and the
 * permission that lets the owner hand the catalogue to one trusted person
 * without handing over their own login.
 */
class ABranchSellsWhatItListsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Branch $main;

    private Branch $town;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'), 'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->main = Branch::withoutTenancy()->where('tenant_id', $this->shop->id)->where('is_default', true)->firstOrFail();
        $this->town = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Johar Town', 'code' => 'JT', 'kind' => Branch::KIND_SHOP,
            'is_default' => false, 'is_active' => true,
        ]);
    }

    private function as(User $user, ?Branch $at = null): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->withToken($token);
        if ($at !== null) {
            $this->withHeader('X-Branch-Id', $at->id);
        }

        return $this;
    }

    private function staff(Branch $at, array $extra = []): User
    {
        return User::factory()->tenantStaff($this->shop, [
            Permissions::PRODUCTS_MANAGE, Permissions::SALES_MANAGE, Permissions::INVENTORY_MANAGE, ...$extra,
        ])->create(['branch_id' => $at->id]);
    }

    /** An item carded by the owner standing at a branch, listed where asked. */
    private function item(string $name, ?Branch $only = null, array $more = [], ?Branch $standing = null): string
    {
        $body = $more + ['item_type' => 'physical_product', 'name' => $name, 'sku' => strtoupper(str_replace(' ', '-', $name)), 'price' => 100, 'tax_rate' => 0, 'track_inventory' => false];
        if ($only !== null) {
            $body += ['all_branches' => false, 'branch_ids' => [$only->id]];
        }

        return (string) $this->as($this->owner, $standing ?? $this->main)->postJson('/api/v1/products', $body)->assertCreated()->json('data.id');
    }

    private function onHand(string $productId, Branch $at): float
    {
        return (float) BranchStock::withoutTenancy()->where('branch_id', $at->id)->where('product_id', $productId)->sum('quantity');
    }

    // ── the permission ───────────────────────────────────────────────

    public function test_someone_the_owner_allows_lists_at_every_branch_without_the_owners_login(): void
    {
        $trusted = $this->staff($this->town, [Permissions::PRODUCTS_ANY_BRANCH]);

        $all = $this->as($trusted)->postJson('/api/v1/products', ['item_type' => 'physical_product', 'name' => 'Everywhere', 'price' => 10, 'all_branches' => true])->assertCreated()->json('data.id');
        $this->assertTrue((bool) Product::query()->withoutGlobalScopes()->whereKey($all)->value('all_branches'));

        $main = $this->as($trusted)->postJson('/api/v1/products', ['item_type' => 'physical_product', 'name' => 'Main Only', 'price' => 10, 'all_branches' => false, 'branch_ids' => [$this->main->id]])->assertCreated()->json('data.id');
        $this->assertSame([$this->main->id], DB::table('branch_product')->where('product_id', $main)->pluck('branch_id')->all());

        // …and changes what the owner listed everywhere.
        $owners = $this->item('Owner Rice');
        $this->as($trusted)->putJson("/api/v1/products/{$owners}", ['name' => 'Owner Rice 2', 'price' => 110])->assertOk();
    }

    public function test_someone_allowed_who_ticks_nothing_starts_at_their_own_branch(): void
    {
        $trusted = $this->staff($this->town, [Permissions::PRODUCTS_ANY_BRANCH]);
        $id = $this->as($trusted)->postJson('/api/v1/products', ['item_type' => 'physical_product', 'name' => 'Untitled', 'price' => 10])->assertCreated()->json('data.id');

        $this->assertSame([$this->town->id], DB::table('branch_product')->where('product_id', $id)->pluck('branch_id')->all());
    }

    public function test_the_permission_reaches_categories_too(): void
    {
        $trusted = $this->staff($this->town, [Permissions::PRODUCTS_ANY_BRANCH]);
        $plain = $this->staff($this->town);
        $grocery = $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Grocery'])->json('data.id');

        $this->as($plain)->putJson("/api/v1/categories/{$grocery}", ['name' => 'Mine'])->assertStatus(403);
        $this->as($trusted)->putJson("/api/v1/categories/{$grocery}", ['name' => 'Grocery & Staples'])->assertOk();
        $this->as($trusted)->postJson('/api/v1/categories', ['name' => 'For All', 'all_branches' => true])->assertCreated();
        $this->as($plain)->postJson('/api/v1/categories', ['name' => 'Not Mine To Spread', 'all_branches' => true])->assertStatus(403);
    }

    public function test_the_permission_is_offered_on_the_staff_screen_and_in_no_preset(): void
    {
        $this->assertContains(Permissions::PRODUCTS_ANY_BRANCH, Permissions::tenant());
        foreach (StaffPresets::all() as $preset) {
            $this->assertNotContains(Permissions::PRODUCTS_ANY_BRANCH, $preset['permissions'] ?? [], 'a preset made a branch manager catalogue-wide by default');
        }
    }

    // ── the till ─────────────────────────────────────────────────────

    public function test_scanning_an_item_sold_only_elsewhere_says_so_by_name(): void
    {
        $this->item('Town Kulfi', $this->town);

        $this->as($this->owner, $this->main)->getJson('/api/v1/pos/lookup?code=TOWN-KULFI')
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'NOT_SOLD_HERE');
        $this->as($this->owner, $this->town)->getJson('/api/v1/pos/lookup?code=TOWN-KULFI')->assertOk();
    }

    public function test_a_sale_of_an_item_sold_only_elsewhere_is_refused_and_writes_nothing(): void
    {
        $kulfi = $this->item('Town Kulfi', $this->town);
        $before = Sale::query()->withoutGlobalScopes()->count();

        $this->as($this->owner, $this->main)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100,
            'items' => [['product_id' => $kulfi, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'NOT_SOLD_HERE');
        $this->assertSame($before, Sale::query()->withoutGlobalScopes()->count());

        $this->as($this->owner, $this->town)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100,
            'items' => [['product_id' => $kulfi, 'quantity' => 1]],
        ])->assertCreated();
    }

    public function test_the_till_catalogue_sends_an_item_sold_elsewhere_as_a_tombstone(): void
    {
        $kulfi = $this->item('Town Kulfi', $this->town);
        $rice = $this->item('Rice');

        $rows = collect($this->as($this->owner, $this->main)->getJson('/api/v1/pos/catalog')->assertOk()->json('data.products.items'))->keyBy('id');
        $this->assertTrue($rows[$kulfi]['deleted'] ?? false, 'Main\'s till was offered a Johar Town item');
        $this->assertArrayNotHasKey('deleted', $rows[$rice]);

        $rows = collect($this->as($this->owner, $this->town)->getJson('/api/v1/pos/catalog')->json('data.products.items'))->keyBy('id');
        $this->assertArrayNotHasKey('deleted', $rows[$kulfi]);
    }

    public function test_a_till_that_held_an_item_hears_when_it_is_moved_away(): void
    {
        // Main → Johar Town: no column of the item changes (it was named
        // before and is named after), and the till hears only by updated_at.
        $rice = $this->item('Rice', $this->main);
        $cursor = $this->as($this->owner, $this->main)->getJson('/api/v1/pos/catalog')->json('data.products.cursor');

        $this->travel(5)->seconds();
        $this->as($this->owner)->putJson("/api/v1/products/{$rice}", ['all_branches' => false, 'branch_ids' => [$this->town->id]])->assertOk();

        $rows = collect($this->as($this->owner, $this->main)->getJson('/api/v1/pos/catalog?products='.urlencode((string) $cursor))->json('data.products.items'))->keyBy('id');
        $this->assertTrue($rows[$rice]['deleted'] ?? false, 'Main\'s till kept selling an item moved to Johar Town');
    }

    public function test_the_till_catalogue_shows_a_shelf_only_where_it_stands(): void
    {
        $bakery = $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Town Bakery', 'all_branches' => false, 'branch_ids' => [$this->town->id]])->json('data.id');

        $rows = collect($this->as($this->owner, $this->main)->getJson('/api/v1/pos/catalog')->json('data.categories.items'))->keyBy('id');
        $this->assertTrue($rows[$bakery]['deleted'] ?? false);
        $rows = collect($this->as($this->owner, $this->town)->getJson('/api/v1/pos/catalog')->json('data.categories.items'))->keyBy('id');
        $this->assertArrayNotHasKey('deleted', $rows[$bakery]);
    }

    public function test_a_selling_screen_asks_for_the_branch_it_rings_at_even_in_the_owners_all_view(): void
    {
        $this->item('Town Kulfi', $this->town);
        $this->item('Rice');

        $all = collect($this->as($this->owner)->getJson('/api/v1/products')->json('data'))->pluck('name')->sort()->values()->all();
        $till = collect($this->as($this->owner)->getJson('/api/v1/products?sold_here=1')->json('data'))->pluck('name')->all();

        $this->assertSame(['Rice', 'Town Kulfi'], $all);
        $this->assertSame(['Rice'], $till, 'the owner\'s till at Main offered a Johar Town item');
    }

    // ── paper ────────────────────────────────────────────────────────

    public function test_a_quote_at_one_branch_refuses_an_item_sold_only_at_another(): void
    {
        $kulfi = $this->item('Town Kulfi', $this->town);

        $this->as($this->owner, $this->main)->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'items' => [['product_id' => $kulfi, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'NOT_SOLD_HERE');
        $this->as($this->owner, $this->town)->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'items' => [['product_id' => $kulfi, 'quantity' => 1]],
        ])->assertCreated();
    }

    // ── stock ────────────────────────────────────────────────────────

    public function test_the_reorder_list_at_a_branch_is_what_that_branch_sells(): void
    {
        $this->item('Town Kulfi', $this->town, ['track_inventory' => true, 'stock_quantity' => 1, 'low_stock_threshold' => 5], $this->town);
        $this->item('Rice', null, ['track_inventory' => true, 'stock_quantity' => 1, 'low_stock_threshold' => 5]);

        $main = collect($this->as($this->owner, $this->main)->getJson('/api/v1/inventory/low-stock')->assertOk()->json('data'))->pluck('name')->all();
        $town = collect($this->as($this->owner, $this->town)->getJson('/api/v1/inventory/low-stock')->json('data'))->pluck('name')->sort()->values()->all();

        $this->assertSame(['Rice'], $main, 'Main was told to reorder an item it does not sell');
        $this->assertContains('Town Kulfi', $town);
    }

    public function test_a_count_sheet_holds_what_the_branch_sells_and_what_is_still_on_its_shelf(): void
    {
        $this->item('Town Kulfi', $this->town, ['track_inventory' => true, 'stock_quantity' => 3], $this->town);
        $leftover = $this->item('Old Stock', null, ['track_inventory' => true, 'stock_quantity' => 4]);
        // The owner stops selling it at Main, with four still on Main's shelf.
        $this->as($this->owner)->putJson("/api/v1/products/{$leftover}", ['all_branches' => false, 'branch_ids' => [$this->town->id]])->assertOk();

        $count = $this->as($this->owner, $this->main)->postJson('/api/v1/inventory/counts', [])->assertCreated()->json('data.id');
        $names = StockCountItem::withoutTenancy()->where('stock_count_id', $count)->pluck('product_name')->all();

        $this->assertContains('Old Stock', $names, 'stock on Main\'s shelf was left off Main\'s count');
        $this->assertNotContains('Town Kulfi', $names, 'Main was asked to count an item it never held');
    }

    public function test_stock_sent_to_a_branch_that_did_not_sell_it_is_listed_there_on_arrival(): void
    {
        $atta = $this->item('Main Atta', $this->main, ['track_inventory' => true, 'stock_quantity' => 20]);

        $sent = $this->as($this->owner, $this->main)->postJson('/api/v1/inventory/transfers', [
            'mode' => 'send', 'from_branch_id' => $this->main->id, 'to_branch_id' => $this->town->id,
            'items' => [['product_id' => $atta, 'quantity' => 8]],
        ])->assertCreated()->json('data');
        $this->as($this->owner, $this->town)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive")->assertOk();

        $this->assertEqualsWithDelta(8, $this->onHand($atta, $this->town), 0.001);
        $this->as($this->owner, $this->town)->getJson('/api/v1/pos/lookup?code=MAIN-ATTA')->assertOk();
        $this->assertEqualsCanonicalizing([$this->main->id, $this->town->id], DB::table('branch_product')->where('product_id', $atta)->pluck('branch_id')->all());
    }

    // ── import, search ───────────────────────────────────────────────

    public function test_a_branch_managers_file_lists_at_their_branch_and_cannot_rewrite_an_all_branch_item(): void
    {
        $this->item('Rice');
        $manager = $this->staff($this->town);
        $csv = "Name,SKU,Price,Item Type\nTown Lassi,TOWN-LASSI,80,physical_product\nRice Renamed,RICE,999,physical_product\n";

        $out = $this->as($manager)->post('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent('items.csv', $csv),
        ], ['Accept' => 'application/json'])->assertOk()->json('data');

        $this->assertSame(1, $out['created']);
        $this->assertSame(1, $out['failed'], 'a manager\'s file rewrote an item sold at every branch');
        $lassi = Product::query()->withoutGlobalScopes()->where('sku', 'TOWN-LASSI')->value('id');
        $this->assertSame([$this->town->id], DB::table('branch_product')->where('product_id', $lassi)->pluck('branch_id')->all());
        $this->assertSame('Rice', Product::query()->withoutGlobalScopes()->where('sku', 'RICE')->value('name'));
    }

    public function test_the_search_box_finds_what_the_branch_sells(): void
    {
        $this->item('Town Kulfi', $this->town);
        $this->item('Kulfi Cone');

        $found = collect($this->as($this->owner, $this->main)->getJson('/api/v1/search?q=kulfi')->assertOk()->json('data.groups'))
            ->firstWhere('type', 'product')['items'] ?? [];
        $this->assertSame(['Kulfi Cone'], collect($found)->pluck('name')->all());
    }
}
