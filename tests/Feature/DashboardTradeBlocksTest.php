<?php

namespace Tests\Feature;

use App\Enums\PaymentMethod;
use App\Enums\SaleChannel;
use App\Enums\SaleStatus;
use App\Models\DiningTable;
use App\Models\KitchenTicket;
use App\Models\RestaurantTicket;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * The two figures a trade opens the app for.
 *
 * Everything else on this dashboard answers a question every shop has: what did
 * I take, what do I owe, what is running low. These two answer a question only
 * one trade has — and a restaurant at 8pm does not want today's revenue, it
 * wants to know how many tables are sat and what is stacking up on the pass.
 *
 * Both blocks are null for a shop that is not that trade, so the panel is
 * absent rather than empty: the rule the rest of the payload already follows.
 */
class DashboardTradeBlocksTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    // ── The restaurant floor ────────────────────────────────────────────

    public function test_occupancy_counts_tables_with_a_running_tab(): void
    {
        $shop = $this->shop('restaurant');
        $t1 = $this->table($shop, 'T1');
        $t2 = $this->table($shop, 'T2');
        $this->table($shop, 'T3');

        $this->tab($shop, $t1);
        $this->tab($shop, $t2);

        $floor = $this->dashboard($shop)['floor'];

        $this->assertSame(3, $floor['tables']);
        $this->assertSame(2, $floor['occupied']);
        $this->assertSame(2, $floor['open_tabs']);
    }

    public function test_a_settled_table_is_free_again(): void
    {
        // Occupancy is DERIVED from an open ticket — closing the tab frees the
        // table with no second column to fall out of step with it.
        $shop = $this->shop('restaurant');
        $table = $this->table($shop, 'T1');
        $tab = $this->tab($shop, $table);

        $tab->forceFill(['status' => 'closed', 'closed_at' => now()])->save();

        $floor = $this->dashboard($shop)['floor'];

        $this->assertSame(1, $floor['tables']);
        $this->assertSame(0, $floor['occupied']);
        $this->assertSame(0, $floor['open_tabs']);
    }

    public function test_a_takeaway_tab_is_an_open_tab_but_occupies_no_table(): void
    {
        $shop = $this->shop('restaurant');
        $this->table($shop, 'T1');
        $this->tab($shop, null, ['order_type' => 'takeaway']);

        $floor = $this->dashboard($shop)['floor'];

        $this->assertSame(0, $floor['occupied']);
        $this->assertSame(1, $floor['open_tabs']);
    }

    public function test_the_pass_separates_still_cooking_from_waiting_to_be_run(): void
    {
        // Two states a kitchen genuinely distinguishes: food still on the stove,
        // and food sitting under the lamp going cold because nobody ran it.
        $shop = $this->shop('restaurant');
        $tab = $this->tab($shop, $this->table($shop, 'T1'));

        $this->kot($shop, $tab);                                   // fired, cooking
        $this->kot($shop, $tab);                                   // fired, cooking
        $this->kot($shop, $tab, ['ready_at' => now()]);            // on the pass
        $this->kot($shop, $tab, ['ready_at' => now(), 'served_at' => now()]); // gone

        $floor = $this->dashboard($shop)['floor'];

        $this->assertSame(2, $floor['kot_waiting']);
        $this->assertSame(1, $floor['kot_ready']);
    }

    public function test_an_inactive_table_is_not_part_of_the_floor(): void
    {
        $shop = $this->shop('restaurant');
        $this->table($shop, 'T1');
        $this->table($shop, 'Broken', ['is_active' => false]);

        $this->assertSame(1, $this->dashboard($shop)['floor']['tables']);
    }

    public function test_a_shop_without_dine_in_is_told_nothing_about_a_floor(): void
    {
        // A mart has no tables. An empty block would invite a panel of zeroes.
        $this->assertNull($this->dashboard($this->shop('mart'))['floor']);
    }

    // ── The dispensing counter ──────────────────────────────────────────

    public function test_only_sales_carrying_a_prescription_are_dispensing(): void
    {
        // A medical store's day is two businesses: over-the-counter trade, and
        // the scripts it is answerable for. Only the second has a prescriber.
        $shop = $this->shop('pharmacy');

        $this->sale($shop, 1200, 'RX-001', 'Dr. Anwar');
        $this->sale($shop, 800, 'RX-002', 'Dr. Anwar');
        $this->sale($shop, 5000, null, null);           // shampoo and a toothbrush

        $rx = $this->dashboard($shop)['dispensing'];

        $this->assertSame(2, $rx['rx_sales']);
        $this->assertEquals(2000, $rx['rx_revenue']);
    }

    public function test_prescribers_are_counted_once_however_many_scripts_they_wrote(): void
    {
        $shop = $this->shop('pharmacy');

        $this->sale($shop, 500, 'RX-001', 'Dr. Anwar');
        $this->sale($shop, 500, 'RX-002', 'Dr. Anwar');
        $this->sale($shop, 500, 'RX-003', 'Dr. Fatima');

        $this->assertSame(2, $this->dashboard($shop)['dispensing']['prescribers']);
    }

    public function test_an_empty_prescription_number_is_not_a_prescription(): void
    {
        // A blank string is what an untouched form field submits. It is not a
        // script, and counting it would inflate the one figure an inspector asks
        // a pharmacist to produce.
        $shop = $this->shop('pharmacy');
        $this->sale($shop, 500, '', '');

        $this->assertSame(0, $this->dashboard($shop)['dispensing']['rx_sales']);
    }

    public function test_yesterdays_scripts_are_not_todays(): void
    {
        $shop = $this->shop('pharmacy');
        $this->sale($shop, 500, 'RX-001', 'Dr. Anwar');
        $this->sale($shop, 900, 'RX-OLD', 'Dr. Anwar', soldAt: now()->subDay());

        $rx = $this->dashboard($shop)['dispensing'];

        $this->assertSame(1, $rx['rx_sales']);
        $this->assertEquals(500, $rx['rx_revenue']);
    }

    public function test_an_old_clinic_code_still_gets_its_dispensing_figures(): void
    {
        // `clinic` resolves onto `pharmacy` — a shop created before the eight
        // current codes must not lose the panel its trade exists for.
        $shop = $this->shop('clinic');
        $this->sale($shop, 700, 'RX-001', 'Dr. Anwar');

        $this->assertSame(1, $this->dashboard($shop)['dispensing']['rx_sales']);
    }

    public function test_a_shop_that_is_not_a_pharmacy_is_asked_nothing_about_scripts(): void
    {
        $this->assertNull($this->dashboard($this->shop('mart'))['dispensing']);
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private function shop(string $type): Tenant
    {
        return Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => $type,
            'features' => BusinessTypes::defaultFeatures($type),
            'timezone' => 'UTC',
        ]);
    }

    /** @return array<string, mixed> */
    private function dashboard(Tenant $shop): array
    {
        $owner = User::factory()->shopOwner($shop)->create();
        $token = $owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->getJson('/api/v1/dashboard')->assertOk()->json('data');
    }

    /** @param  array<string, mixed>  $overrides */
    private function table(Tenant $shop, string $name, array $overrides = []): DiningTable
    {
        return DiningTable::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'name' => $name,
            'seats' => 4,
            'is_active' => true,
            ...$overrides,
        ]);
    }

    /** @param  array<string, mixed>  $overrides */
    private function tab(Tenant $shop, ?DiningTable $table, array $overrides = []): RestaurantTicket
    {
        return RestaurantTicket::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'ticket_number' => 'TAB-'.random_int(10000, 99999),
            'dining_table_id' => $table?->id,
            'order_type' => 'dine_in',
            'status' => 'open',
            'opened_at' => now(),
            ...$overrides,
        ]);
    }

    /** @param  array<string, mixed>  $overrides */
    private function kot(Tenant $shop, RestaurantTicket $tab, array $overrides = []): KitchenTicket
    {
        return KitchenTicket::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'ticket_id' => $tab->id,
            'kot_number' => random_int(1, 999),
            'station' => 'Kitchen',
            'status' => 'fired',
            'fired_at' => now(),
            ...$overrides,
        ]);
    }

    private function sale(Tenant $shop, float $total, ?string $rx, ?string $prescriber, ?Carbon $soldAt = null): Sale
    {
        return Sale::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'invoice_number' => 'INV-'.random_int(10000, 99999),
            'channel' => SaleChannel::Pos->value,
            'payment_method' => PaymentMethod::Cash->value,
            'status' => SaleStatus::Completed->value,
            'subtotal' => $total,
            'total' => $total,
            'amount_paid' => $total,
            'sold_at' => $soldAt ?? now(),
            'prescription_number' => $rx,
            'prescriber_name' => $prescriber,
        ]);
    }
}
