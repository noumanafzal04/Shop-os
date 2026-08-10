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
