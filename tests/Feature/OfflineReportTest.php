<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * What happened while the shop was offline.
 *
 * The morning after a power cut an owner has one question, and it is not a
 * technical one: what did I miss, and is anything wrong? Every assertion here
 * is part of that answer — what came in late, what needs a decision, and what
 * needs a recount.
 */
class OfflineReportTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function sale(array $over = []): Sale
    {
        return Sale::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->tenant->id,
            'invoice_number' => 'INV-'.Str::random(6),
            'channel' => 'pos',
            'status' => 'completed',
            'subtotal' => 200,
            'discount' => 0,
            'tax' => 0,
            'total' => 200,
            'payment_method' => 'cash',
            'amount_paid' => 200,
            'change_due' => 0,
            'sold_at' => now()->subDays(2),
            'synced_at' => now()->subDay(),
            // Unique per sale, because the shop-wide unique index says so —
            // a fixture that reused one was refused by the database, which
            // is the constraint doing its job.
            'offline_number' => 'OFF-L1-AB-'.Str::random(6),
        ], $over));
    }

    private function report(): array
    {
        return $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/offline')->assertOk()->json('data');
    }

    // ── What came in late ───────────────────────────────────────────

    public function test_it_counts_what_arrived_late_and_what_it_was_worth(): void
    {
        $this->sale();
        $this->sale(['total' => 350]);

        $summary = $this->report()['summary'];

        $this->assertSame(2, $summary['sales']);
        $this->assertEqualsWithDelta(550.0, $summary['total'], 0.001);
    }

    public function test_an_ordinary_online_sale_is_not_in_this_report(): void
    {
        // `synced_at` is what makes a sale late. Without this the screen would
        // be a second sales list, and the one thing it is for would be lost in
        // it.
        $this->sale(['synced_at' => null, 'offline_number' => null]);

        $this->assertSame(0, $this->report()['summary']['sales']);
    }

    public function test_it_shows_the_slip_the_customer_is_holding(): void
    {
        // The only reference that customer has. An owner searching for the
        // sale they are being asked about has nothing else to go on.
        $this->sale(['offline_number' => 'OFF-L1-AB-000001']);

        $this->assertSame('OFF-L1-AB-000001', $this->report()['sales'][0]['offline_number']);
    }

    public function test_it_says_how_long_the_sale_sat_on_the_till(): void
    {
        // The number that tells a two-hour cut from a fortnight nobody noticed.
        $this->sale([
            'sold_at' => now()->subDays(3),
            'synced_at' => now()->subDays(3)->addHours(30),
        ]);

        $this->assertSame(30, $this->report()['sales'][0]['held_hours']);
    }

    // ── What needs a decision ───────────────────────────────────────

    public function test_a_flagged_sale_is_counted_and_carries_its_reasons(): void
    {
        $this->sale(['offline_violations' => ['Khata needs the connection']]);
        $this->sale();

        $data = $this->report();

        $this->assertSame(1, $data['summary']['flagged']);
        $this->assertSame(2, $data['summary']['sales']);
        $this->assertNotEmpty($data['sales'][0]['violations']);
    }

    public function test_flagged_sales_come_first(): void
    {
        // The handful that need a decision must not sit on page three behind
        // ninety that were fine — that is the whole reason this screen is open.
        $this->sale(['sold_at' => now()->subHour()]);
        $this->sale(['sold_at' => now()->subDays(5), 'offline_violations' => ['Coupon']]);

        $this->assertNotEmpty($this->report()['sales'][0]['violations']);
    }

    public function test_it_counts_what_was_rung_past_the_shops_window(): void
    {
        // TWO sales, only one past the window. With a single sale the count is
        // 1 whether the filter is applied or not, and the test would pass over
        // a report that simply counted everything — a mutation proved exactly
        // that, staying green with the filter removed.
        $this->sale(['beyond_offline_window' => true]);
        $this->sale(['beyond_offline_window' => false]);

        $data = $this->report();
        $this->assertSame(2, $data['summary']['sales']);
        $this->assertSame(1, $data['summary']['beyond_window']);
        $this->assertTrue(collect($data['sales'])->firstWhere('beyond_window', true) !== null);
    }

    public function test_it_names_the_money_that_landed_against_a_signed_off_day(): void
    {
        // Tuesday's drawers were counted, the day was closed and the cash went
        // to the bank. On Wednesday morning Tuesday's sales arrive. Nothing in
        // the books may move — a day signed off in March has to read the same
        // in September — so this figure is the shop's only warning that
        // Tuesday's recorded takings are now short of Tuesday's sales.
        $this->sale(['after_day_close' => true, 'total' => 1200]);
        $this->sale(['after_day_close' => true, 'total' => 800]);
        $this->sale(['after_day_close' => false, 'total' => 5000]);

        $data = $this->report();
        $this->assertSame(2, $data['summary']['after_close']);
        // The VALUE, not the count: an adjustment is written from a figure.
        $this->assertEqualsWithDelta(2000.0, $data['summary']['after_close_total'], 0.001);
        $this->assertSame(3, $data['summary']['sales']);
    }

    public function test_a_sale_that_beat_the_close_is_not_named(): void
    {
        // It was in the totals when the owner counted. Flagging it would send
        // somebody looking for a shortfall that does not exist.
        $this->sale(['after_day_close' => false]);

        $data = $this->report();
        $this->assertSame(0, $data['summary']['after_close']);
        $this->assertEqualsWithDelta(0.0, $data['summary']['after_close_total'], 0.001);
        $this->assertFalse($data['sales'][0]['after_close']);
    }

    // ── What needs a recount ────────────────────────────────────────

    public function test_it_lists_stock_that_went_below_zero(): void
    {
        // Two tills offline can each sell the last carton, and BOTH are telling
        // the truth. No sale is wrong, so no sale can be found by looking for a
        // mistake — the shelf is what is wrong, and the shelf says so plainly.
        $branch = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Main', 'is_default' => true,
        ]);
        $product = Product::query()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'item_type' => 'physical_product', 'name' => 'Milkpak 1L', 'sku' => 'MLK', 'price' => 100,
        ]);
        BranchStock::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $branch->id,
            'product_id' => $product->id, 'quantity' => -2,
        ]);

        $oversold = $this->report()['oversold'];

        $this->assertCount(1, $oversold);
        $this->assertSame('Milkpak 1L', $oversold[0]['product']);
        $this->assertEqualsWithDelta(-2.0, $oversold[0]['quantity'], 0.001);
    }

    public function test_stock_that_is_merely_low_is_not_a_recount(): void
    {
        $branch = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Main', 'is_default' => true,
        ]);
        $product = Product::query()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'item_type' => 'physical_product', 'name' => 'Milkpak 1L', 'price' => 100,
        ]);
        BranchStock::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $branch->id,
            'product_id' => $product->id, 'quantity' => 0,
        ]);

        $this->assertSame([], $this->report()['oversold']);
    }

    // ── The quiet answer ────────────────────────────────────────────

    public function test_a_shop_that_was_never_offline_reads_as_nothing_happened(): void
    {
        $data = $this->report();

        $this->assertSame(0, $data['summary']['sales']);
        $this->assertSame([], $data['sales']);
        $this->assertSame([], $data['oversold']);
    }

    // ── Whose report it is ──────────────────────────────────────────

    public function test_a_cashier_cannot_read_it(): void
    {
        $cashier = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();

        $this->actingAsUser($cashier)->getJson('/api/v1/reports/offline')->assertForbidden();
    }

    public function test_one_shops_offline_day_is_not_anothers(): void
    {
        $other = Tenant::factory()->create(['setup_completed' => true]);
        $otherOwner = User::factory()->shopOwner($other)->create();
        $this->sale();

        $data = $this->actingAsUser($otherOwner)
            ->getJson('/api/v1/reports/offline')->assertOk()->json('data');

        $this->assertSame(0, $data['summary']['sales']);
    }
}
