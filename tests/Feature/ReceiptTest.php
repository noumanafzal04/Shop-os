<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\HardwareDevice;
use App\Models\Product;
use App\Models\ReceiptPrint;
use App\Models\Register;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Receipts — the only artefact that leaves the building.
 *
 * What this suite pins down:
 *   - the first receipt off a sale is the original and every one after it is
 *     stamped a copy, decided by the SERVER (a till cannot ask for a second
 *     "original", which is the whole control);
 *   - a gift copy carries no prices;
 *   - a split tender prints every leg, because one line cannot be reconciled;
 *   - who served and at which lane is on the paper;
 *   - tax identifiers print only for a shop that has them;
 *   - a print the till reports as failed lands in a recovery tray, and a later
 *     good print clears it without anyone marking anything;
 *   - copies are countable per cashier;
 *   - the settings preview renders the same template and writes nothing.
 */
class ReceiptTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private User $cashier;

    private Branch $main;

    private Register $lane1;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create(['name' => 'Owner']);
        $this->cashier = User::factory()
            ->tenantStaff($this->tenant, ['sales.manage', 'sales.void', 'sales.refund'])
            ->create(['name' => 'Ayesha']);

        $this->main = Branch::withoutTenancy()
            ->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();

        $this->lane1 = Register::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $this->main->id,
            'name' => 'Lane 1', 'is_active' => true,
        ]);

        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Basmati Rice', 'sku' => 'RICE-5K', 'price' => 950, 'cost' => 800,
            'stock_quantity' => 100, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** Rings a plain cash sale and returns it. */
    private function ringSale(?User $user = null, array $overrides = []): Sale
    {
        $data = $this->actingAsUser($user ?? $this->cashier)
            ->withHeader('X-Register-Id', $this->lane1->id)
            ->postJson('/api/v1/sales', [
                'channel' => 'pos',
                'payment_method' => 'cash',
                'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
                'amount_paid' => 1000,
                ...$overrides,
            ])->assertCreated()->json('data');

        return Sale::withoutTenancy()->findOrFail($data['id']);
    }

    private function fetchReceipt(Sale $sale, array $query = [], ?User $user = null): \Illuminate\Testing\TestResponse
    {
        return $this->actingAsUser($user ?? $this->cashier)
            ->withHeader('X-Register-Id', $this->lane1->id)
            ->get('/api/v1/sales/'.$sale->id.'/invoice'.($query === [] ? '' : '?'.http_build_query($query)));
    }

    // ── Original vs copy ────────────────────────────────────────────

    public function test_the_first_receipt_is_the_original_and_is_logged(): void
    {
        $sale = $this->ringSale();

        $response = $this->fetchReceipt($sale)->assertOk();
        $response->assertHeader('X-Receipt-Kind', ReceiptPrint::ORIGINAL);

        $print = ReceiptPrint::withoutTenancy()->where('sale_id', $sale->id)->sole();
        $this->assertSame(ReceiptPrint::ORIGINAL, $print->kind);
        $this->assertSame(1, $print->copy_no);
        $this->assertSame($this->cashier->id, $print->user_id);
        $this->assertSame($this->lane1->id, $print->register_id);
        // An original says nothing on its face.
        $response->assertDontSee('Reprint');
    }

    public function test_the_second_receipt_is_stamped_a_reprint(): void
    {
        $sale = $this->ringSale();
        $this->fetchReceipt($sale)->assertOk();

        $second = $this->fetchReceipt($sale)->assertOk();
        $second->assertHeader('X-Receipt-Kind', ReceiptPrint::REPRINT);
        $second->assertSee('Reprint · Copy 2', false);

        $this->assertSame(2, ReceiptPrint::withoutTenancy()->where('sale_id', $sale->id)->count());
    }

    /**
     * The whole control: the client has no say in whether its receipt counts
     * as an original. Asking for one anyway still yields a stamped copy.
     */
    public function test_a_client_cannot_request_a_second_original(): void
    {
        $sale = $this->ringSale();
        $this->fetchReceipt($sale)->assertOk();

        $this->fetchReceipt($sale, ['copy' => 'original'])->assertStatus(422);

        $this->fetchReceipt($sale)->assertHeader('X-Receipt-Kind', ReceiptPrint::REPRINT);
    }

    /** A jammed print may still have reached the customer — the next is a copy. */
    public function test_a_failed_print_still_advances_the_copy_number(): void
    {
        $sale = $this->ringSale();
        $printId = $this->fetchReceipt($sale)->assertOk()->headers->get('X-Receipt-Print-Id');

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/receipt-prints/{$printId}/outcome", ['status' => 'failed', 'error' => 'No paper'])
            ->assertOk();

        $this->fetchReceipt($sale)->assertHeader('X-Receipt-Kind', ReceiptPrint::REPRINT);
    }

    public function test_a_gift_copy_hides_every_price(): void
    {
        $sale = $this->ringSale();

        $gift = $this->fetchReceipt($sale, ['copy' => 'gift'])->assertOk();
        $gift->assertSee('Gift Receipt', false);
        $gift->assertSee('Basmati Rice', false);
        // No amount, no total, no tender.
        $gift->assertDontSee('950.00');
        $gift->assertDontSee('Subtotal');
        $gift->assertDontSee('Change');

        $this->assertSame(
            ReceiptPrint::GIFT,
            ReceiptPrint::withoutTenancy()->where('sale_id', $sale->id)->sole()->kind,
        );
    }

    // ── What is on the paper ────────────────────────────────────────

    public function test_a_split_tender_prints_every_leg(): void
    {
        $data = $this->actingAsUser($this->cashier)
            ->withHeader('X-Register-Id', $this->lane1->id)
            ->postJson('/api/v1/sales', [
                'channel' => 'pos',
                'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
                'payments' => [
                    ['method' => 'cash', 'amount' => 500],
                    ['method' => 'card', 'amount' => 450],
                ],
            ])->assertCreated()->json('data');
        $sale = Sale::withoutTenancy()->findOrFail($data['id']);

        $receipt = $this->fetchReceipt($sale)->assertOk();
        $receipt->assertSee('Cash', false);
        $receipt->assertSee('Card', false);
        $receipt->assertSee('500.00', false);
        $receipt->assertSee('450.00', false);
    }

    public function test_the_receipt_names_the_cashier_and_the_lane(): void
    {
        $sale = $this->ringSale();

        $this->fetchReceipt($sale)->assertOk()
            ->assertSee('Ayesha', false)
            ->assertSee('Lane 1', false);
    }

    public function test_the_cashier_line_can_be_turned_off(): void
    {
        $this->tenant->update(['settings' => ['receipt_show_cashier' => false]]);
        $sale = $this->ringSale();

        $this->fetchReceipt($sale)->assertOk()->assertDontSee('Ayesha');
    }

    public function test_tax_identifiers_print_only_when_the_shop_has_them(): void
    {
        $sale = $this->ringSale();
        $this->fetchReceipt($sale)->assertOk()->assertDontSee('NTN');

        $this->tenant->update(['settings' => [
            'invoice_ntn' => '1234567-8',
            'invoice_strn' => '03-04-8765-432-11',
            'invoice_fbr_pos_id' => '556677',
        ]]);

        $this->fetchReceipt($sale)->assertOk()
            ->assertSee('NTN 1234567-8', false)
            ->assertSee('STRN 03-04-8765-432-11', false)
            ->assertSee('FBR POS 556677', false);
    }

    public function test_a_cancelled_sale_prints_as_cancelled(): void
    {
        $sale = $this->ringSale();

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sales/{$sale->id}/cancel", ['reason_code' => 'price_error'])
            ->assertOk();

        $this->fetchReceipt($sale->fresh())->assertOk()->assertSee('Cancelled', false);
    }

    public function test_a_thermal_roll_renders_the_narrow_layout(): void
    {
        $this->tenant->update(['settings' => ['receipt_width' => 'thermal_58']]);
        $sale = $this->ringSale();

        $this->fetchReceipt($sale)->assertOk()
            // The roll layout sizes the page to the paper; the sheet never does.
            ->assertSee('size: 58mm auto', false)
            ->assertDontSee('Customer signature');
    }

    /** The narrow layout drops a whole column for a gift copy — exercise it. */
    public function test_a_gift_copy_on_a_roll_still_hides_prices(): void
    {
        $this->tenant->update(['settings' => ['receipt_width' => 'thermal_80']]);
        $sale = $this->ringSale();

        $this->fetchReceipt($sale, ['copy' => 'gift'])->assertOk()
            ->assertSee('Gift Receipt', false)
            ->assertSee('Basmati Rice', false)
            ->assertDontSee('950.00')
            ->assertDontSee('Subtotal')
            ->assertDontSee('Change');
    }

    public function test_a_sheet_renders_the_filed_document_layout(): void
    {
        $sale = $this->ringSale();

        $this->fetchReceipt($sale)->assertOk()
            ->assertSee('Customer signature', false)
            ->assertSee('Description', false);
    }

    // ── Which printer ───────────────────────────────────────────────

    public function test_the_print_records_the_printer_this_lane_drives(): void
    {
        $lanePrinter = HardwareDevice::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'register_id' => $this->lane1->id,
            'type' => 'receipt_printer', 'name' => 'Lane 1 printer',
            'connection_type' => 'serial', 'is_default' => true, 'is_active' => true,
        ]);
        HardwareDevice::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'register_id' => null,
            'type' => 'receipt_printer', 'name' => 'Back office printer',
            'connection_type' => 'browser', 'is_default' => true, 'is_active' => true,
        ]);

        $sale = $this->ringSale();
        $this->fetchReceipt($sale)->assertOk();

        $print = ReceiptPrint::withoutTenancy()->where('sale_id', $sale->id)->sole();
        $this->assertSame($lanePrinter->id, $print->device_id);
        $this->assertSame('serial', $print->transport);
    }

    // ── Recovery ────────────────────────────────────────────────────

    public function test_a_failed_print_lands_in_the_reprint_tray(): void
    {
        $sale = $this->ringSale();
        $printId = $this->fetchReceipt($sale)->assertOk()->headers->get('X-Receipt-Print-Id');

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/receipt-prints/{$printId}/outcome", ['status' => 'failed', 'error' => 'Printer offline'])
            ->assertOk();

        $this->actingAsUser($this->cashier)->getJson('/api/v1/receipts/pending')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.error', 'Printer offline')
            ->assertJsonPath('data.0.sale.invoice_number', $sale->invoice_number);
    }

    /** No one marks it resolved — printing it again is what resolves it. */
    public function test_a_later_good_print_clears_the_tray_by_itself(): void
    {
        $sale = $this->ringSale();
        $printId = $this->fetchReceipt($sale)->assertOk()->headers->get('X-Receipt-Print-Id');
        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/receipt-prints/{$printId}/outcome", ['status' => 'failed'])
            ->assertOk();

        // Retry: a second render that nobody reports as failed.
        $this->travel(1)->seconds();
        $this->fetchReceipt($sale)->assertOk();

        $this->actingAsUser($this->cashier)->getJson('/api/v1/receipts/pending')
            ->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_an_outcome_can_only_be_printed_or_failed(): void
    {
        $sale = $this->ringSale();
        $printId = $this->fetchReceipt($sale)->assertOk()->headers->get('X-Receipt-Print-Id');

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/receipt-prints/{$printId}/outcome", ['status' => 'shredded'])
            ->assertStatus(422);
    }

    // ── The trail and the count ─────────────────────────────────────

    public function test_the_trail_lists_every_copy_of_one_sale(): void
    {
        $sale = $this->ringSale();
        $this->fetchReceipt($sale);
        $this->fetchReceipt($sale, ['reason' => 'Customer lost it']);

        $this->actingAsUser($this->cashier)->getJson("/api/v1/sales/{$sale->id}/receipt-prints")
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.kind', 'original')
            ->assertJsonPath('data.1.kind', 'reprint')
            ->assertJsonPath('data.1.reason', 'Customer lost it')
            ->assertJsonPath('data.1.user.name', 'Ayesha');
    }

    public function test_copies_are_countable_per_cashier(): void
    {
        $sale = $this->ringSale();
        $this->fetchReceipt($sale);
        $this->fetchReceipt($sale);
        $this->fetchReceipt($sale);

        $rows = $this->actingAsUser($this->owner)->getJson('/api/v1/reports/reprints')
            ->assertOk()->json('data.rows');

        $ayesha = collect($rows)->firstWhere('user_name', 'Ayesha');
        $this->assertSame(1, $ayesha['original']);
        $this->assertSame(2, $ayesha['reprint']);
    }

    public function test_the_reprint_report_needs_the_reports_permission(): void
    {
        $tillOnly = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();

        $this->actingAsUser($tillOnly)->getJson('/api/v1/reports/reprints')->assertForbidden();
    }

    // ── Preview ─────────────────────────────────────────────────────

    public function test_the_settings_preview_renders_without_writing_anything(): void
    {
        $this->actingAsUser($this->owner)
            ->get('/api/v1/receipts/preview?'.http_build_query([
                'invoice_header' => 'Since 1998',
                'invoice_footer' => 'No returns without a receipt',
                'receipt_width' => 'thermal_80',
                'invoice_ntn' => '9988776-5',
            ]))
            ->assertOk()
            ->assertSee('Since 1998', false)
            ->assertSee('No returns without a receipt', false)
            ->assertSee('NTN 9988776-5', false)
            ->assertSee('size: 80mm auto', false)
            ->assertSee('Sample data', false);

        $this->assertSame(0, ReceiptPrint::withoutTenancy()->count());
        $this->assertSame(0, Sale::withoutTenancy()->count());
    }

    /** Overrides are what the shopkeeper is typing — they must beat what is saved. */
    public function test_the_preview_prefers_the_settings_being_edited(): void
    {
        $this->tenant->update(['settings' => ['invoice_footer' => 'Old footer', 'receipt_width' => 'standard']]);

        $this->actingAsUser($this->owner)
            ->get('/api/v1/receipts/preview?invoice_footer='.urlencode('New footer'))
            ->assertOk()
            ->assertSee('New footer', false)
            ->assertDontSee('Old footer');
    }

    public function test_the_preview_can_show_a_reprint_stamp(): void
    {
        $this->actingAsUser($this->owner)->get('/api/v1/receipts/preview?kind=reprint')
            ->assertOk()->assertSee('Reprint · Copy 2', false);
    }

    // ── Tenancy ─────────────────────────────────────────────────────

    public function test_a_receipt_from_another_shop_is_not_reachable(): void
    {
        $other = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $otherOwner = User::factory()->shopOwner($other)->create();
        $sale = $this->ringSale();

        $this->actingAsUser($otherOwner)->get("/api/v1/sales/{$sale->id}/invoice")->assertNotFound();
    }
}
