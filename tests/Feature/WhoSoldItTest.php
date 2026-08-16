<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Who sold it, as opposed to who rang it.
 *
 * `ReportService::staffPerformance` grouped completed sales by `created_by` and
 * the panel titled it "Staff performance". Those are two different claims: the
 * service's own docblock said "grouped by the staff who rang them up", and the
 * screen did not.
 *
 * In a one-person shop the two are the same person. On a showroom floor —
 * garments, shoes, electronics — three or four salesmen work the customers and
 * one cashier rings everything, so the report credited the cashier with the
 * whole month and the men who did the work appeared nowhere.
 *
 * Same defect the forecourt had: a figure computed perfectly and owed by
 * nobody. Worse here, because a wrong name on a performance report reads as a
 * judgement about a person.
 */
class WhoSoldItTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $showroom;

    private User $owner;

    private User $cashier;

    private User $salesman;

    private Product $shirt;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Faisalabad', 'is_active' => true]);
        $this->showroom = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
        ]);

        $this->owner = User::factory()->shopOwner($this->showroom)->create(['name' => 'Owner']);
        // The one at the counter, who types every sale in the shop.
        $this->cashier = User::factory()->tenantStaff($this->showroom, ['sales.manage'])
            ->create(['name' => 'Counter Sara']);
        // The one on the floor, who sold it.
        $this->salesman = User::factory()->tenantStaff($this->showroom, ['sales.manage'])
            ->create(['name' => 'Bilal']);

        $this->shirt = Product::withoutTenancy()->create([
            'tenant_id' => $this->showroom->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Shirt', 'price' => 1000, 'cost' => 600, 'stock_quantity' => 100,
            'track_inventory' => true, 'tax_rate' => 0,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withHeader('Authorization', "Bearer {$token}");
    }

    /** @param array<string, mixed> $extra */
    private function sell(User $ringingIt, array $extra = []): array
    {
        return $this->actingAsUser($ringingIt)->postJson('/api/v1/sales', array_merge([
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'items' => [['product_id' => $this->shirt->id, 'quantity' => 1]],
            'amount_paid' => 1000,
        ], $extra))->assertCreated()->json('data');
    }

    private function staffReport(): array
    {
        return $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/staff?period=monthly')
            ->assertOk()->json('data');
    }

    // ── The column ──────────────────────────────────────────────────────

    public function test_a_sale_records_who_sold_it_separately_from_who_rang_it(): void
    {
        $sale = $this->sell($this->cashier, ['served_by' => $this->salesman->id]);

        $this->assertDatabaseHas('sales', [
            'id' => $sale['id'],
            'created_by' => $this->cashier->id,
            'served_by' => $this->salesman->id,
        ]);
    }

    public function test_a_seller_from_another_shop_is_refused(): void
    {
        // A performance figure has to name somebody the owner can go and talk
        // to.
        $stranger = User::factory()->create();

        $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'items' => [['product_id' => $this->shirt->id, 'quantity' => 1]],
            'amount_paid' => 1000,
            'served_by' => $stranger->id,
        ])->assertStatus(422)->assertJsonValidationErrors('served_by');
    }

    public function test_naming_nobody_is_normal_and_changes_nothing(): void
    {
        // Most shops on this platform. One counter, one person.
        $sale = $this->sell($this->cashier);

        $this->assertDatabaseHas('sales', ['id' => $sale['id'], 'served_by' => null]);
    }

    // ── The report ──────────────────────────────────────────────────────

    public function test_the_till_figure_is_unchanged_and_still_names_the_cashier(): void
    {
        // Nothing about this feature may move the number that says who operated
        // the till — that one was never wrong, only mislabelled.
        $this->sell($this->cashier, ['served_by' => $this->salesman->id]);

        $till = collect($this->staffReport()['staff']);

        $this->assertCount(1, $till);
        $this->assertSame('Counter Sara', $till->first()['name']);
        $this->assertEquals(1000, $till->first()['revenue']);
    }

    public function test_the_report_credits_the_man_who_sold_it(): void
    {
        $this->sell($this->cashier, ['served_by' => $this->salesman->id]);
        $this->sell($this->cashier, ['served_by' => $this->salesman->id]);

        $served = collect($this->staffReport()['served']);

        $this->assertCount(1, $served, 'the salesman is the only seller named');
        $this->assertSame('Bilal', $served->first()['name']);
        $this->assertSame(2, $served->first()['sales_count']);
        $this->assertEquals(2000, $served->first()['revenue']);
    }

    public function test_a_shop_that_never_names_anybody_gets_no_second_table(): void
    {
        // Absent, not empty. A table of nobodies on a screen a one-person shop
        // opens is worse than no table.
        $this->sell($this->cashier);

        $report = $this->staffReport();

        $this->assertSame([], $report['served']);
        $this->assertNull($report['unattributed']);
    }

    public function test_what_nobody_was_named_for_is_reported_as_exactly_that(): void
    {
        // The honest half. Once a shop starts attributing, the sales it did not
        // attribute must be visible AS unattributed — folding them into the
        // cashier's row is the lie this whole column exists to stop.
        $this->sell($this->cashier, ['served_by' => $this->salesman->id]);
        $this->sell($this->cashier);
        $this->sell($this->cashier);

        $report = $this->staffReport();

        $this->assertSame(1, collect($report['served'])->firstWhere('name', 'Bilal')['sales_count']);
        $this->assertSame(2, $report['unattributed']['sales_count']);
        $this->assertEquals(2000, $report['unattributed']['revenue']);
    }

    public function test_an_unattributed_sale_is_never_credited_to_the_cashier(): void
    {
        // The defect, stated as a test. Sara rang it; nobody said who sold it;
        // Sara must not appear as a seller.
        $this->sell($this->cashier, ['served_by' => $this->salesman->id]);
        $this->sell($this->cashier);

        $served = collect($this->staffReport()['served']);

        $this->assertNull($served->firstWhere('name', 'Counter Sara'));
    }

    // ── The till only asks when the shop wants it asked ─────────────────

    public function test_the_counter_is_not_asked_by_default(): void
    {
        // A picker on every sale, in a shop where the answer is always the same
        // person, is a slower till bought with nothing.
        $data = $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/bootstrap')->assertOk()->json('data');

        $this->assertFalse((bool) ($data['settings']['pos_ask_who_served'] ?? false));
        $this->assertSame([], $data['sellers']);

        // And the counter's own call agrees — a till that is not asking has no
        // reason to be holding a staff list.
        $this->assertSame([], $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/sellers')->assertOk()->json('data'));
    }

    public function test_the_offline_till_carries_the_same_list_as_the_online_one(): void
    {
        // One method answers both, so the two cannot come to disagree about who
        // works here — and a till that loses its connection can still say who
        // sold it.
        $this->actingAsUser($this->owner)
            ->putJson('/api/v1/shop/settings', ['pos_ask_who_served' => true])->assertOk();

        $cached = $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/bootstrap')->assertOk()->json('data.sellers');
        $live = $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/sellers')->assertOk()->json('data');

        $this->assertSame($cached, $live);
        $this->assertNotSame([], $live);
    }

    public function test_a_cashier_can_read_the_seller_list_without_being_able_to_edit_staff(): void
    {
        // The `*.manage` mistake this codebase has already paid for once: a
        // write permission fencing a read. Naming a colleague must not require
        // the permission that EDITS colleagues, so the names ride the catalog
        // the till already pulls.
        $this->actingAsUser($this->owner)
            ->putJson('/api/v1/shop/settings', ['pos_ask_who_served' => true])->assertOk();

        $this->assertFalse($this->cashier->hasPermission('staff.manage'));

        $data = $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/bootstrap')->assertOk()->json('data');

        $names = collect($data['sellers'])->pluck('name');

        $this->assertTrue((bool) $data['settings']['pos_ask_who_served']);
        $this->assertTrue($names->contains('Bilal'));
        $this->assertTrue($names->contains('Counter Sara'));
    }

    public function test_the_seller_list_is_this_shop_only(): void
    {
        $this->actingAsUser($this->owner)
            ->putJson('/api/v1/shop/settings', ['pos_ask_who_served' => true])->assertOk();

        $otherShop = Tenant::factory()->create(['setup_completed' => true]);
        User::factory()->tenantStaff($otherShop, ['sales.manage'])->create(['name' => 'Somebody Else']);

        $data = $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/bootstrap')->assertOk()->json('data');

        $this->assertFalse(collect($data['sellers'])->pluck('name')->contains('Somebody Else'));
    }
}
