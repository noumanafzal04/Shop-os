<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class SalesTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $widget;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->widget = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'type' => 'product',
            'name' => 'Widget',
            'sku' => 'W-1',
            'price' => 100,
            'cost' => 60,
            'stock_quantity' => 10,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function salePayload(array $overrides = []): array
    {
        return array_merge([
            'channel' => 'walk_in',
            'items' => [
                ['product_id' => $this->widget->id, 'quantity' => 2],
            ],
            'payment_method' => 'cash',
            'amount_paid' => 200,
        ], $overrides);
    }

    // ── Happy path ──────────────────────────────────────────────────

    public function test_complete_sale_decrements_stock_and_snapshots_lines(): void
    {
        $response = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload());

        $response->assertCreated()
            ->assertJsonPath('data.invoice_number', 'INV-000001')
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.total', '200.00')
            ->assertJsonPath('data.items.0.product_name', 'Widget')
            ->assertJsonPath('data.items.0.unit_cost', '60.00');

        // Stock decremented through the audited inventory path.
        $this->assertEquals(8, $this->widget->fresh()->stock_quantity);
        $movement = StockMovement::withoutTenancy()->first();
        $this->assertSame('sale', $movement->reference_type);
        $this->assertEquals(-2, $movement->quantity_change);
    }

    public function test_invoice_numbers_are_sequential_and_tenant_isolated(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload());
        $second = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload());

        $second->assertJsonPath('data.invoice_number', 'INV-000002');

        // A different tenant starts its own sequence at 1.
        $otherTenant = Tenant::factory()->provisioned()->create();
        $otherOwner = User::factory()->shopOwner($otherTenant)->create();
        $otherProduct = Product::withoutTenancy()->create([
            'tenant_id' => $otherTenant->id, 'type' => 'product',
            'name' => 'Other', 'price' => 50, 'stock_quantity' => 5,
        ]);

        $this->actingAsUser($otherOwner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $otherProduct->id, 'quantity' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => 50,
        ])->assertCreated()->assertJsonPath('data.invoice_number', 'INV-000001');
    }

    public function test_change_due_is_calculated(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload([
            'amount_paid' => 250,
        ]))->assertCreated()->assertJsonPath('data.change_due', '50.00');
    }

    public function test_discount_applies_and_client_unit_price_is_ignored(): void
    {
        // Pricing is server-authoritative: a client-sent unit_price (90) is
        // dropped — the widget prices at its real 100. 2 × 100 = 200 subtotal,
        // − 30 discount = 170 total. (Guards the CRIT-4 price-override fix.)
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload([
            'items' => [
                ['product_id' => $this->widget->id, 'quantity' => 2, 'unit_price' => 90],
            ],
            'discount' => 30,
            'amount_paid' => 170,
        ]))->assertCreated()
            ->assertJsonPath('data.subtotal', '200.00')
            ->assertJsonPath('data.total', '170.00')
            ->assertJsonPath('data.items.0.unit_price', '100.00');
    }

    // ── Edge cases ──────────────────────────────────────────────────

    public function test_double_click_complete_sale_creates_one_sale(): void
    {
        $payload = $this->salePayload(['idempotency_key' => 'pos-777']);

        $first = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $payload)
            ->assertCreated()->json('data');
        $second = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $payload)
            ->assertCreated()->json('data');

        $this->assertSame($first['id'], $second['id']);
        $this->assertSame(1, Sale::withoutTenancy()->count());
        // Stock decremented exactly once.
        $this->assertEquals(8, $this->widget->fresh()->stock_quantity);
    }

    public function test_out_of_stock_at_checkout_rolls_back_everything(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload([
            'items' => [['product_id' => $this->widget->id, 'quantity' => 11]], // only 10
            'amount_paid' => 1100,
        ]))->assertStatus(422)->assertJsonPath('meta.error_code', 'INSUFFICIENT_STOCK');

        // Nothing persisted: no sale, no movement, stock intact...
        $this->assertSame(0, Sale::withoutTenancy()->count());
        $this->assertSame(0, StockMovement::withoutTenancy()->count());
        $this->assertEquals(10, $this->widget->fresh()->stock_quantity);

        // ...and the invoice sequence has NO gap.
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload())
            ->assertCreated()->assertJsonPath('data.invoice_number', 'INV-000001');
    }

    public function test_underpayment_rejected(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload([
            'amount_paid' => 150, // total is 200
        ]))->assertStatus(422)->assertJsonPath('meta.error_code', 'PAYMENT_INSUFFICIENT');
    }

    public function test_discount_exceeding_subtotal_rejected(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload([
            'discount' => 500,
        ]))->assertStatus(422)->assertJsonPath('meta.error_code', 'DISCOUNT_EXCEEDS_SUBTOTAL');
    }

    public function test_inactive_product_cannot_be_sold(): void
    {
        $this->widget->update(['is_active' => false]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload())
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'PRODUCT_UNAVAILABLE');
    }

    public function test_service_sells_without_stock_effect(): void
    {
        $service = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'service',
            'name' => 'Repair', 'price' => 500, 'track_inventory' => false,
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $service->id, 'quantity' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => 500,
        ])->assertCreated();

        $this->assertSame(0, StockMovement::withoutTenancy()->count());
    }

    public function test_variant_sale_decrements_variant_stock(): void
    {
        $variant = ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $this->widget->id,
            'name' => 'Red', 'sku' => 'W-1-R', 'price' => 120, 'cost' => 70, 'stock_quantity' => 4,
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $this->widget->id, 'variant_id' => $variant->id, 'quantity' => 3]],
            'payment_method' => 'cash',
            'amount_paid' => 360,
        ])->assertCreated()
            ->assertJsonPath('data.items.0.variant_name', 'Red')
            ->assertJsonPath('data.items.0.unit_price', '120.00');

        $this->assertEquals(1, $variant->fresh()->stock_quantity);
        $this->assertEquals(10, $this->widget->fresh()->stock_quantity); // parent untouched
    }

    // ── Cancellation ────────────────────────────────────────────────

    public function test_cancel_restores_stock_and_double_cancel_conflicts(): void
    {
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload())
            ->json('data');
        $this->assertEquals(8, $this->widget->fresh()->stock_quantity);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item', 'reason' => 'Customer returned'])
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled');

        $this->assertEquals(10, $this->widget->fresh()->stock_quantity);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item'])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'SALE_ALREADY_CANCELLED');

        // Restore happened exactly once (idempotent per item).
        $this->assertEquals(10, $this->widget->fresh()->stock_quantity);
    }

    public function test_deleting_product_after_sale_keeps_history(): void
    {
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload())
            ->json('data');

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/products/{$this->widget->id}")
            ->assertOk();

        // Sale detail still shows the snapshot.
        $this->actingAsUser($this->owner)->getJson("/api/v1/sales/{$sale['id']}")
            ->assertOk()
            ->assertJsonPath('data.items.0.product_name', 'Widget');
    }

    // ── Listing / dashboard / authz ─────────────────────────────────

    public function test_sales_list_filters_and_isolation(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload([
            'customer_name' => 'Ahmed',
        ]));

        $found = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/sales?search=Ahmed')
            ->assertOk()
            ->json('meta.pagination.total');
        $this->assertSame(1, $found);

        // Other tenant sees nothing. Provisioned like a real shop — sale READS
        // now carry a module gate, so a bare factory tenant would 403 here and
        // the isolation this asserts would go untested behind the refusal.
        $otherOwner = User::factory()->shopOwner(Tenant::factory()->provisioned()->create())->create();
        $this->assertSame(0, $this->actingAsUser($otherOwner)
            ->getJson('/api/v1/sales')
            ->json('meta.pagination.total'));
    }

    /**
     * The slip in the customer's bag is the only reference they have.
     *
     * A till with no server prints `OFF-…` instead of an invoice number, and the
     * server keeps both on sync FOR THIS — so if the search does not match it,
     * keeping it bought nothing. And because a return is
     * `POST /sales/{id}/returns`, a sale that cannot be found is a sale that
     * cannot be returned.
     *
     * The number is set directly rather than through a sync round trip: what is
     * under test is the lookup, not the queue.
     */
    public function test_a_slip_number_finds_the_sale_it_was_printed_for(): void
    {
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload())
            ->json('data');

        Sale::withoutGlobalScopes()->find($sale['id'])
            ->update(['offline_number' => 'OFF-LANE1-A3F2-000042']);

        $this->assertSame(1, $this->actingAsUser($this->owner)
            ->getJson('/api/v1/sales?search=OFF-LANE1-A3F2-000042')
            ->assertOk()
            ->json('meta.pagination.total'));

        // A staff member reads part of a smudged slip.
        $this->assertSame(1, $this->actingAsUser($this->owner)
            ->getJson('/api/v1/sales?search=A3F2')
            ->json('meta.pagination.total'));

        // And it still narrows: another shop's slip number matches nothing.
        $this->assertSame(0, $this->actingAsUser($this->owner)
            ->getJson('/api/v1/sales?search=OFF-LANE9-ZZZZ-000999')
            ->json('meta.pagination.total'));
    }

    /**
     * The export is meant to be the same rows as the screen. It shares the
     * search clause so it cannot drift, and it carries the slip number — a
     * shop reconciling a day that arrived three days late is matching paper
     * against rows by hand.
     */
    public function test_the_export_carries_the_slip_number_and_shares_the_search(): void
    {
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload())
            ->json('data');

        Sale::withoutGlobalScopes()->find($sale['id'])
            ->update(['offline_number' => 'OFF-LANE1-A3F2-000042']);

        $csv = $this->actingAsUser($this->owner)
            ->get('/api/v1/sales/export?search=OFF-LANE1-A3F2-000042')
            ->assertOk()
            ->streamedContent();

        $this->assertStringContainsString('offline_number', $csv);
        $this->assertStringContainsString('OFF-LANE1-A3F2-000042', $csv);
        // One data row, not the whole ledger — the filter travelled.
        $this->assertSame(1, substr_count($csv, $sale['invoice_number']));
    }

    /**
     * THE FILTERS THE HELP CENTRE HAS ALWAYS PROMISED.
     *
     * "Filter by date, payment method or who rang it" has been printed in the
     * sales article since it was written, over a screen that could do none of
     * them and a server that had only the date. A help page describing a
     * control that is not there does not read as a missing feature — it reads
     * as a control the shopkeeper failed to find.
     */
    public function test_the_ledger_can_be_narrowed_by_how_it_was_paid(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload([
            'payment_method' => 'cash',
        ]))->assertCreated();
        $card = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload([
            'payment_method' => 'card',
        ]))->json('data');

        $rows = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/sales?payment_method=card')
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame($card['invoice_number'], $rows[0]['invoice_number']);
        // The denominator: two sales exist, so this is one picked out of two.
        $this->assertCount(2, $this->actingAsUser($this->owner)->getJson('/api/v1/sales')->json('data'));
    }

    public function test_the_ledger_can_be_narrowed_to_who_rang_it(): void
    {
        $cashier = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload())->assertCreated();
        $theirs = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload([
            'served_by' => $cashier->id,
        ]))->json('data');

        $rows = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/sales?served_by='.$cashier->id)
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame($theirs['invoice_number'], $rows[0]['invoice_number']);
    }

    public function test_the_ledger_can_be_narrowed_to_where_it_was_rung(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload([
            'channel' => 'walk_in',
        ]))->assertCreated();
        $pos = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload([
            'channel' => 'pos',
        ]))->json('data');

        $rows = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/sales?channel=pos')
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame($pos['invoice_number'], $rows[0]['invoice_number']);
    }

    public function test_a_sale_rung_today_is_inside_a_range_that_ends_today(): void
    {
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload())->json('data');

        Sale::withoutGlobalScopes()->find($sale['id'])->update(['sold_at' => now()->setTime(17, 45)]);

        $rows = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/sales?to='.now()->toDateString())
            ->assertOk()
            ->json('data');

        // A `to` compared against midnight would drop every sale rung during
        // the day it names — which is the range this screen is opened with.
        $this->assertCount(1, $rows);
    }

    /**
     * THE EXPORT AND THE LIST ARE ONE FILTER.
     *
     * They were two copies of the same seven-line chain, under an export
     * docblock promising they matched. This is the test that fails if the
     * eighth filter is ever added to only one of them — which would be the
     * export, because it is the copy nobody looks at.
     */
    public function test_the_export_honours_every_filter_the_list_does(): void
    {
        $cashier = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();

        $wanted = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload([
            'payment_method' => 'card',
            'channel' => 'pos',
            'served_by' => $cashier->id,
        ]))->json('data');

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload([
            'payment_method' => 'cash',
            'channel' => 'walk_in',
        ]))->assertCreated();

        foreach ([
            'payment_method=card',
            'channel=pos',
            'served_by='.$cashier->id,
        ] as $filter) {
            $csv = $this->actingAsUser($this->owner)
                ->get('/api/v1/sales/export?'.$filter)
                ->assertOk()
                ->streamedContent();

            $this->assertSame(
                1,
                substr_count($csv, $wanted['invoice_number']),
                "the export dropped the filter: {$filter}",
            );
            // …and it left the other sale out, or "the filter travelled" would
            // be true of an export that simply wrote everything.
            $this->assertSame(2, substr_count($csv, "\n"), "the export wrote more than one row for: {$filter}");
        }
    }

    public function test_dashboard_today_reflects_sales_and_profit(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload());

        // revenue 200, cogs 2×60=120 → profit 80
        $this->actingAsUser($this->owner)->getJson('/api/v1/dashboard')
            ->assertOk()
            ->assertJsonPath('data.today.sales_count', 1)
            ->assertJsonPath('data.today.revenue', 200)
            ->assertJsonPath('data.today.profit', 80);
    }

    public function test_cancelled_sales_excluded_from_dashboard(): void
    {
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload())
            ->json('data');
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item']);

        $this->actingAsUser($this->owner)->getJson('/api/v1/dashboard')
            ->assertJsonPath('data.today.sales_count', 0)
            ->assertJsonPath('data.today.revenue', 0);
    }

    public function test_staff_without_sales_permission_blocked(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::PRODUCTS_MANAGE])->create();

        $this->actingAsUser($staff)->postJson('/api/v1/sales', $this->salePayload())
            ->assertStatus(403);
    }

    public function test_invoice_html_renders(): void
    {
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->salePayload())
            ->json('data');

        $response = $this->actingAsUser($this->owner)->get("/api/v1/sales/{$sale['id']}/invoice");

        $response->assertOk();
        $this->assertStringContainsString('INV-000001', $response->getContent());
        $this->assertStringContainsString('Widget', $response->getContent());
    }
}
