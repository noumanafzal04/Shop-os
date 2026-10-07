<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\CustomerVehicle;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\SaleDocument;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * PARTS AND LABOUR GO ON AS YOU WORK.
 *
 * The workshop board, the book-in sheet and the job card's own comments all
 * said so. Nothing did it: a job card kept the one line it was booked in with,
 * so a car booked in for a diagnostic hour and then given pads and labour could
 * only be billed for the diagnostic hour. Found by the auto shop's journey.
 */
class AJobGrowsAsTheWorkIsDoneTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $cashier;

    private Product $check;   // Rs 1,500 diagnostic hour (a service)

    private Product $pads;    // Rs 4,500 a set

    private Product $labour;  // Rs 1,000 an hour

    private CustomerVehicle $car;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'automotive',
            'features' => BusinessTypes::defaultFeatures('automotive'),
        ]);
        // `discounts.apply` because two cases knock rupees off at booking, which is
        // the same authority as discounting a live sale.
        $this->cashier = User::factory()->tenantStaff($this->tenant, ['sales.manage', 'customers.manage', 'discounts.apply'])->create();

        $this->check = $this->item('Diagnostic hour', 1500, 'service');
        $this->pads = $this->item('Brake pads', 4500);
        $this->labour = $this->item('Labour (hour)', 1000, 'service');

        $this->car = CustomerVehicle::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'registration' => 'LEA-4291', 'make' => 'Toyota', 'model' => 'Corolla',
        ]);
    }

    private function item(string $name, float $price, string $type = 'product', array $over = []): Product
    {
        return Product::query()->create(array_merge([
            'tenant_id' => $this->tenant->id,
            'type' => $type,
            'item_type' => $type === 'service' ? 'service' : 'physical_product',
            'name' => $name,
            'price' => $price,
            'stock_quantity' => $type === 'service' ? 0 : 20,
            'track_inventory' => $type !== 'service',
            'is_active' => true,
        ], $over));
    }

    private function as(): static
    {
        $token = $this->cashier->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function book(array $over = []): array
    {
        return $this->as()->postJson('/api/v1/sale-documents', array_merge([
            'kind' => 'job_card',
            'vehicle_id' => $this->car->id,
            'complaint' => 'Noise from front left when braking',
            'items' => [['product_id' => $this->check->id, 'quantity' => 1]],
        ], $over))->assertCreated()->json('data');
    }

    private function add(string $job, Product $item, float $qty = 1, array $over = []): TestResponse
    {
        return $this->as()->postJson("/api/v1/sale-documents/{$job}/items", ['product_id' => $item->id, 'quantity' => $qty] + $over);
    }

    private function line(array $doc, Product $item): array
    {
        return collect($doc['items'])->firstWhere('product_id', $item->id);
    }

    // ── it grows ─────────────────────────────────────────────────────

    public function test_parts_and_labour_go_on_and_the_job_comes_to_all_of_them(): void
    {
        $job = $this->book();
        $this->assertEqualsWithDelta(1500.0, (float) $job['total'], 0.001);

        $this->add($job['id'], $this->pads)->assertOk();
        $doc = $this->add($job['id'], $this->labour, 2)->assertOk()->json('data');

        $this->assertCount(3, $doc['items']);
        $this->assertEqualsWithDelta(2000.0, (float) $this->line($doc, $this->labour)['line_total'], 0.001);
        $this->assertEqualsWithDelta(8000.0, (float) $doc['subtotal'], 0.001);
        $this->assertEqualsWithDelta(8000.0, (float) $doc['total'], 0.001);
        $this->assertEqualsWithDelta(8000.0, (float) $doc['balance'], 0.001);
    }

    public function test_billed_it_is_billed_for_everything_that_went_on_it(): void
    {
        $job = $this->book();
        $this->add($job['id'], $this->pads)->assertOk();
        $this->add($job['id'], $this->labour, 2)->assertOk();

        $result = $this->as()->postJson("/api/v1/sale-documents/{$job['id']}/convert", [
            'payment_method' => 'cash', 'amount_paid' => 8000,
        ])->assertCreated()->json('data');

        $this->assertEqualsWithDelta(8000.0, (float) $result['sale']['total'], 0.001);
        $sale = $this->as()->getJson("/api/v1/sales/{$result['sale']['id']}")->json('data');
        $this->assertEqualsCanonicalizing(['Diagnostic hour', 'Brake pads', 'Labour (hour)'], array_column($sale['items'], 'product_name'));
        $this->assertSame($this->car->id, $sale['vehicle_id']);
        // The pads came off the shelf when the job was billed.
        $this->assertSame(19.0, (float) $this->pads->fresh()->stock_quantity);
    }

    public function test_the_same_part_again_joins_its_line(): void
    {
        $job = $this->book();
        $this->add($job['id'], $this->labour)->assertOk();
        $doc = $this->add($job['id'], $this->labour)->assertOk()->json('data');

        $this->assertCount(2, $doc['items']);
        $this->assertEqualsWithDelta(2.0, (float) $this->line($doc, $this->labour)['quantity'], 0.001);
        $this->assertEqualsWithDelta(3500.0, (float) $doc['total'], 0.001);
    }

    public function test_a_quantity_is_changed_and_the_job_follows(): void
    {
        $job = $this->book();
        $doc = $this->add($job['id'], $this->labour, 3)->assertOk()->json('data');
        $line = $this->line($doc, $this->labour);

        $doc = $this->as()->patchJson("/api/v1/sale-documents/{$job['id']}/items/{$line['id']}", ['quantity' => 1])
            ->assertOk()->json('data');

        $this->assertEqualsWithDelta(1000.0, (float) $this->line($doc, $this->labour)['line_total'], 0.001);
        $this->assertEqualsWithDelta(2500.0, (float) $doc['total'], 0.001);
    }

    public function test_a_line_comes_off_and_the_job_follows(): void
    {
        $job = $this->book();
        $doc = $this->add($job['id'], $this->pads)->assertOk()->json('data');

        $doc = $this->as()->deleteJson("/api/v1/sale-documents/{$job['id']}/items/{$this->line($doc, $this->pads)['id']}")
            ->assertOk()->json('data');

        $this->assertCount(1, $doc['items']);
        $this->assertEqualsWithDelta(1500.0, (float) $doc['total'], 0.001);
    }

    public function test_a_different_size_of_the_same_part_is_its_own_line(): void
    {
        $tyre = $this->item('Tyre', 0);
        $small = ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $tyre->id, 'name' => '175/70 R13', 'price' => 9000, 'stock_quantity' => 8, 'is_active' => true,
        ]);
        $large = ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $tyre->id, 'name' => '195/65 R15', 'price' => 14000, 'stock_quantity' => 8, 'is_active' => true,
        ]);
        $job = $this->book();

        $this->add($job['id'], $tyre, 2, ['variant_id' => $small->id])->assertOk();
        $doc = $this->add($job['id'], $tyre, 2, ['variant_id' => $large->id])->assertOk()->json('data');

        $this->assertCount(3, $doc['items']);
        $this->assertEqualsWithDelta(1500 + 18000 + 28000, (float) $doc['total'], 0.001);
    }

    public function test_rupees_off_one_line_stay_off_when_its_quantity_changes(): void
    {
        $job = $this->book(['items' => [['product_id' => $this->labour->id, 'quantity' => 2, 'line_discount' => 300]]]);
        $this->assertEqualsWithDelta(1700.0, (float) $job['total'], 0.001);

        $doc = $this->as()->patchJson("/api/v1/sale-documents/{$job['id']}/items/{$job['items'][0]['id']}", ['quantity' => 3])
            ->assertOk()->json('data');

        $this->assertEqualsWithDelta(300.0, (float) $doc['items'][0]['line_discount'], 0.001);
        $this->assertEqualsWithDelta(2700.0, (float) $doc['total'], 0.001);
    }

    // ── what it will not do ──────────────────────────────────────────

    public function test_the_last_line_cannot_come_off(): void
    {
        $job = $this->book();

        $this->as()->deleteJson("/api/v1/sale-documents/{$job['id']}/items/{$job['items'][0]['id']}")
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'JOB_CARD_EMPTY');
        $this->assertSame(1, SaleDocument::withoutTenancy()->find($job['id'])->items()->count());
    }

    public function test_a_price_cannot_be_named_by_the_screen(): void
    {
        $job = $this->book();
        $doc = $this->add($job['id'], $this->pads, 1, ['unit_price' => 1, 'line_total' => 1])->assertOk()->json('data');

        $this->assertEqualsWithDelta(4500.0, (float) $this->line($doc, $this->pads)['unit_price'], 0.001);
        $this->assertEqualsWithDelta(6000.0, (float) $doc['total'], 0.001);
    }

    public function test_a_billed_job_takes_nothing_more(): void
    {
        $job = $this->book();
        $this->as()->postJson("/api/v1/sale-documents/{$job['id']}/convert", ['payment_method' => 'cash', 'amount_paid' => 1500])->assertCreated();

        $this->add($job['id'], $this->pads)->assertStatus(409)->assertJsonPath('meta.error_code', 'JOB_NOT_OPEN');
        $this->as()->patchJson("/api/v1/sale-documents/{$job['id']}/items/{$job['items'][0]['id']}", ['quantity' => 3])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'JOB_NOT_OPEN');
    }

    public function test_a_cancelled_job_takes_nothing_more(): void
    {
        $job = $this->book();
        $this->as()->postJson("/api/v1/sale-documents/{$job['id']}/cancel", ['reason' => 'Took it elsewhere'])->assertOk();

        $this->add($job['id'], $this->pads)->assertStatus(409)->assertJsonPath('meta.error_code', 'JOB_NOT_OPEN');
    }

    public function test_a_quotation_is_a_price_given_and_does_not_grow(): void
    {
        $quote = $this->as()->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'items' => [['product_id' => $this->pads->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->add($quote['id'], $this->labour)->assertStatus(422)->assertJsonPath('meta.error_code', 'NOT_A_JOB_CARD');
        $this->as()->deleteJson("/api/v1/sale-documents/{$quote['id']}/items/{$quote['items'][0]['id']}")
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'NOT_A_JOB_CARD');
    }

    public function test_a_job_cannot_shrink_below_the_advance_already_paid(): void
    {
        $job = $this->book();
        $doc = $this->add($job['id'], $this->pads)->assertOk()->json('data');
        $this->as()->postJson("/api/v1/sale-documents/{$job['id']}/deposits", ['amount' => 5000, 'method' => 'cash'])->assertCreated();

        $this->as()->deleteJson("/api/v1/sale-documents/{$job['id']}/items/{$this->line($doc, $this->pads)['id']}")
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'JOB_BELOW_ADVANCE');
        $this->assertEqualsWithDelta(6000.0, (float) SaleDocument::withoutTenancy()->find($job['id'])->total, 0.001);

        // Growing is always fine, and the balance is what is left after the advance.
        $grown = $this->add($job['id'], $this->labour)->assertOk()->json('data');
        $this->assertEqualsWithDelta(2000.0, (float) $grown['balance'], 0.001);
    }

    public function test_a_line_on_another_job_is_not_this_jobs(): void
    {
        $one = $this->book();
        $two = $this->book();

        $this->as()->deleteJson("/api/v1/sale-documents/{$one['id']}/items/{$two['items'][0]['id']}")
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'JOB_LINE_NOT_FOUND');
    }

    public function test_another_shops_part_cannot_go_on(): void
    {
        $job = $this->book();
        $elsewhere = Tenant::factory()->create(['setup_completed' => true, 'business_type' => 'automotive']);
        $theirs = Product::withoutTenancy()->create([
            'tenant_id' => $elsewhere->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Their pads', 'price' => 10, 'is_active' => true,
        ]);

        $this->as()->postJson("/api/v1/sale-documents/{$job['id']}/items", ['product_id' => $theirs->id, 'quantity' => 1])
            ->assertStatus(422)->assertJsonValidationErrors('product_id');
    }

    public function test_a_part_sold_by_the_piece_takes_a_whole_quantity(): void
    {
        $job = $this->book();

        $this->add($job['id'], $this->pads, 1.5)->assertStatus(422)->assertJsonPath('meta.error_code', 'FRACTIONAL_QTY_NOT_ALLOWED');
    }

    // ── the money around it ──────────────────────────────────────────

    public function test_tax_is_worked_out_on_everything_that_went_on(): void
    {
        $this->tenant->forceFill(['settings' => array_merge($this->tenant->settings ?? [], ['default_tax_rate' => 10])])->save();
        $job = $this->book();
        $this->assertEqualsWithDelta(150.0, (float) $job['tax'], 0.001);

        $doc = $this->add($job['id'], $this->pads)->assertOk()->json('data');

        $this->assertEqualsWithDelta(600.0, (float) $doc['tax'], 0.001);
        $this->assertEqualsWithDelta(6600.0, (float) $doc['total'], 0.001);
    }

    public function test_a_members_discount_is_taken_of_what_the_job_comes_to_now(): void
    {
        $group = CustomerGroup::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Fleet', 'price_level' => 'retail', 'discount_percent' => 10,
        ]);
        Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'City Cabs', 'phone' => '03001112223', 'customer_group_id' => $group->id,
        ]);
        $job = $this->book(['customer_phone' => '03001112223']);
        $this->assertEqualsWithDelta(150.0, (float) $job['discount'], 0.001);

        $doc = $this->add($job['id'], $this->pads)->assertOk()->json('data');

        // 10% of 6,000 — not still 10% of the 1,500 it was booked in at.
        $this->assertEqualsWithDelta(600.0, (float) $doc['discount'], 0.001);
        $this->assertEqualsWithDelta(5400.0, (float) $doc['total'], 0.001);
    }

    public function test_rupees_knocked_off_by_hand_stay_the_same_rupees(): void
    {
        $job = $this->book(['discount' => 200]);
        $this->assertEqualsWithDelta(1300.0, (float) $job['total'], 0.001);

        $doc = $this->add($job['id'], $this->pads)->assertOk()->json('data');

        $this->assertEqualsWithDelta(200.0, (float) $doc['discount'], 0.001);
        $this->assertEqualsWithDelta(5800.0, (float) $doc['total'], 0.001);
    }

    public function test_both_kinds_of_discount_together(): void
    {
        $group = CustomerGroup::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Fleet', 'price_level' => 'retail', 'discount_percent' => 10,
        ]);
        Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'City Cabs', 'phone' => '03001112223', 'customer_group_id' => $group->id,
        ]);
        // 200 by hand, then 10% of the 1,300 left: 330.
        $job = $this->book(['customer_phone' => '03001112223', 'discount' => 200]);
        $this->assertEqualsWithDelta(330.0, (float) $job['discount'], 0.001);

        $doc = $this->add($job['id'], $this->pads)->assertOk()->json('data');

        // 200 by hand, then 10% of the 5,800 left: 780.
        $this->assertEqualsWithDelta(780.0, (float) $doc['discount'], 0.001);
        $this->assertEqualsWithDelta(5220.0, (float) $doc['total'], 0.001);
    }

    public function test_a_wholesale_customers_part_goes_on_at_the_wholesale_price(): void
    {
        $this->pads->forceFill(['wholesale_price' => 4000])->save();
        $group = CustomerGroup::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Trade', 'price_level' => 'wholesale',
        ]);
        Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Garage Two', 'phone' => '03001112224', 'customer_group_id' => $group->id,
        ]);
        $job = $this->book(['customer_phone' => '03001112224']);

        $doc = $this->add($job['id'], $this->pads)->assertOk()->json('data');

        $this->assertEqualsWithDelta(4000.0, (float) $this->line($doc, $this->pads)['unit_price'], 0.001);
    }

    // ── the car learns whose it is ───────────────────────────────────

    public function test_a_car_booked_in_for_a_customer_is_that_customers_car(): void
    {
        $this->assertNull($this->car->customer_id);

        $this->book(['customer_name' => 'Ali Raza', 'customer_phone' => '03005556667']);

        $owner = Customer::withoutTenancy()->where('phone', '03005556667')->firstOrFail();
        $this->assertSame($owner->id, $this->car->fresh()->customer_id);
        // …and the plate lookup at the next visit says so.
        $found = $this->as()->getJson('/api/v1/vehicles-lookup?search=LEA-4291')->json('data.0');
        $this->assertSame('03005556667', $found['customer']['phone']);
    }

    public function test_a_car_sold_to_at_the_till_is_that_customers_car(): void
    {
        $this->as()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 4500,
            'vehicle_id' => $this->car->id, 'customer_phone' => '03005556667', 'customer_name' => 'Ali Raza',
            'items' => [['product_id' => $this->pads->id, 'quantity' => 1]],
        ])->assertCreated();

        $this->assertSame(Customer::withoutTenancy()->where('phone', '03005556667')->value('id'), $this->car->fresh()->customer_id);
    }

    public function test_a_fleet_cars_owner_is_not_replaced_by_this_weeks_driver(): void
    {
        $owner = Customer::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'City Cabs', 'phone' => '03001112223']);
        $this->car->forceFill(['customer_id' => $owner->id])->save();

        $this->book(['customer_name' => 'Driver Asif', 'customer_phone' => '03009998887']);

        $this->assertSame($owner->id, $this->car->fresh()->customer_id);
    }

    public function test_a_job_with_no_customer_leaves_the_car_as_it_was(): void
    {
        $this->book();

        $this->assertNull($this->car->fresh()->customer_id);
    }

    public function test_the_change_is_on_the_jobs_trail(): void
    {
        $job = $this->book();
        $this->add($job['id'], $this->pads)->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'auditable_type' => SaleDocument::class,
            'auditable_id' => $job['id'],
            'event' => 'updated',
        ]);
    }
}
