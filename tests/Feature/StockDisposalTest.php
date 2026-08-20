<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockDisposal;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\ShopSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Where the stock went when it left without being sold.
 *
 * A pharmacy's money does not mostly leak at the counter — it expires on the
 * shelf, and the loss is avoidable because distributors here take medicine back
 * for credit inside a window that closes months before the printed date.
 *
 * The platform computed the warning perfectly and then let a pharmacist act on
 * none of it in a way the books could see: removing a batch wrote one movement
 * whose reason was the generated string "Batch X removed/expired", covering a
 * write-off, a supplier return and a mis-keyed lot alike, and hard-deleted the
 * row — taking the lot's cost with it.
 */
class StockDisposalTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $pharmacy;

    private User $owner;

    private Product $medicine;

    private Supplier $distributor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Multan', 'is_active' => true]);
        $this->pharmacy = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'pharmacy', 'features' => BusinessTypes::defaultFeatures('pharmacy'),
        ]);
        $this->owner = User::factory()->shopOwner($this->pharmacy)->create();

        $this->medicine = Product::withoutTenancy()->create([
            'tenant_id' => $this->pharmacy->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Augmentin 625mg', 'price' => 500, 'cost' => 300,
            'stock_quantity' => 0, 'track_inventory' => true,
        ]);

        $this->distributor = Supplier::withoutTenancy()->create([
            'tenant_id' => $this->pharmacy->id, 'name' => 'Sunny Traders',
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withHeader('Authorization', "Bearer {$token}");
    }

    /** A lot on the shelf, with a cost, near its date. */
    private function batch(float $qty = 40, ?float $cost = 300, string $expiry = '+10 days'): ProductBatch
    {
        $number = 'B-'.ProductBatch::withoutTenancy()->count();

        $id = $this->actingAsUser($this->owner)
            ->postJson("/api/v1/inventory/products/{$this->medicine->id}/batches", [
                'batch_number' => $number,
                'expiry_date' => now()->modify($expiry)->toDateString(),
                'quantity' => $qty,
                'cost' => $cost,
            ])->assertCreated()->json('data.id');

        return ProductBatch::withoutTenancy()->findOrFail($id);
    }

    /**
     * A lot with nothing left on it — the housekeeping case. Created directly
     * because the batches endpoint quite rightly refuses to add zero stock.
     */
    private function emptyBatch(): ProductBatch
    {
        return ProductBatch::withoutTenancy()->create([
            'tenant_id' => $this->pharmacy->id,
            'product_id' => $this->medicine->id,
            'batch_number' => 'B-EMPTY',
            'expiry_date' => now()->addDays(10)->toDateString(),
            'quantity' => 0,
        ]);
    }

    // ── A lot with stock in it may not vanish unexplained ────────────────

    public function test_removing_a_lot_that_still_has_stock_demands_to_know_where_it_went(): void
    {
        // Forty strips of medicine do not disappear. They are binned or they go
        // back to the distributor, and those are opposite facts about the same
        // money.
        $batch = $this->batch();

        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/inventory/batches/{$batch->id}")
            ->assertStatus(422)
            ->assertJsonValidationErrors(['disposition', 'reason']);

        // And nothing moved. A refused removal must not half-happen.
        $this->assertDatabaseHas('product_batches', ['id' => $batch->id, 'quantity' => 40]);
    }

    public function test_an_empty_lot_is_housekeeping_and_needs_no_explanation(): void
    {
        // A mis-keyed batch number, a line being tidied. Demanding a reason for
        // this trains somebody to pick whatever clears the dialogue fastest,
        // and a field answered that way is worse than no field.
        $batch = $this->emptyBatch();

        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/inventory/batches/{$batch->id}")
            ->assertOk();

        $this->assertSoftDeleted('product_batches', ['id' => $batch->id]);
        // No disposal row either: nothing left the shelf.
        $this->assertSame(0, StockDisposal::withoutTenancy()->count());
    }

    // ── Written off ─────────────────────────────────────────────────────

    public function test_a_write_off_records_what_the_binned_stock_cost(): void
    {
        // The figure that was previously destroyed along with the batch row.
        $batch = $this->batch(qty: 40, cost: 300);

        $row = $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/inventory/batches/{$batch->id}", [
                'disposition' => 'written_off', 'reason' => 'expired',
            ])->assertOk()->json('data');

        $this->assertSame('written_off', $row['disposition']);
        $this->assertEquals(40, $row['quantity']);
        $this->assertEquals(12000, $row['total_cost']);
        // A write-off has no counterparty.
        $this->assertNull($row['supplier_id']);
        $this->assertNull($row['credit_expected']);
    }

    public function test_a_lot_with_no_recorded_cost_reports_unknown_and_not_zero(): void
    {
        // Zero is a claim that this medicine cost nothing. Null says nobody
        // wrote it down, and a report can show the difference.
        $batch = $this->batch(qty: 10, cost: null);

        $row = $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/inventory/batches/{$batch->id}", [
                'disposition' => 'written_off', 'reason' => 'expired',
            ])->assertOk()->json('data');

        $this->assertNull($row['total_cost']);
    }

    public function test_the_stock_actually_leaves(): void
    {
        $batch = $this->batch(qty: 40);
        $this->assertEquals(40, $this->medicine->fresh()->stock_quantity);

        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/inventory/batches/{$batch->id}", [
                'disposition' => 'written_off', 'reason' => 'expired',
            ])->assertOk();

        $this->assertEquals(0, $this->medicine->fresh()->stock_quantity);
    }

    // ── Returned to the distributor ─────────────────────────────────────

    public function test_a_return_names_the_distributor_it_is_claimed_from(): void
    {
        // A claim with nobody to claim from is not a claim.
        $batch = $this->batch();

        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/inventory/batches/{$batch->id}", [
                'disposition' => 'returned_to_supplier', 'reason' => 'expired',
            ])->assertStatus(422)->assertJsonValidationErrors('supplier_id');
    }

    public function test_a_return_is_recorded_as_a_claim_and_not_as_a_loss(): void
    {
        $batch = $this->batch(qty: 40, cost: 300);

        $row = $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/inventory/batches/{$batch->id}", [
                'disposition' => 'returned_to_supplier', 'reason' => 'expired',
                'supplier_id' => $this->distributor->id, 'credit_expected' => 11000,
            ])->assertOk()->json('data');

        $this->assertSame($this->distributor->id, $row['supplier_id']);
        $this->assertEquals(11000, $row['credit_expected']);
        // Not settled by the act of sending it. The distributor decides what
        // they credit and when.
        $this->assertNull($row['credit_received_at']);
    }

    public function test_a_written_off_lot_can_never_carry_a_supplier(): void
    {
        // Otherwise bin-bound stock would sit in the list of money somebody is
        // chasing.
        $batch = $this->batch();

        $row = $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/inventory/batches/{$batch->id}", [
                'disposition' => 'written_off', 'reason' => 'expired',
                'supplier_id' => $this->distributor->id, 'credit_expected' => 5000,
            ])->assertOk()->json('data');

        $this->assertNull($row['supplier_id']);
        $this->assertNull($row['credit_expected']);
    }

    // ── Chasing the credit ──────────────────────────────────────────────

    public function test_the_claims_list_is_what_was_sent_back_and_never_credited(): void
    {
        $sent = $this->returnBatch();
        $this->writeOffBatch();

        $rows = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/inventory/disposals?awaiting_credit=1')
            ->assertOk()->json('data');

        $this->assertCount(1, $rows, 'a write-off is not a claim');
        $this->assertSame($sent['id'], $rows[0]['id']);
    }

    public function test_a_settled_claim_leaves_the_list(): void
    {
        $sent = $this->returnBatch();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/inventory/disposals/{$sent['id']}/credit", [
                // Less than was claimed, which is the normal case and the
                // reason the received figure is recorded rather than assumed.
                'credit_received' => 9500,
                'credit_received_at' => now()->toDateString(),
                'credit_reference' => 'CN-4471',
            ])->assertOk();

        $this->assertSame([], $this->actingAsUser($this->owner)
            ->getJson('/api/v1/inventory/disposals?awaiting_credit=1')
            ->assertOk()->json('data'));
    }

    public function test_what_actually_arrived_is_kept_apart_from_what_was_claimed(): void
    {
        // The gap between the two is the number worth reading.
        $sent = $this->returnBatch();

        $row = $this->actingAsUser($this->owner)
            ->postJson("/api/v1/inventory/disposals/{$sent['id']}/credit", [
                'credit_received' => 9500, 'credit_received_at' => now()->toDateString(),
            ])->assertOk()->json('data');

        $this->assertEquals(11000, $row['credit_expected']);
        $this->assertEquals(9500, $row['credit_received']);
    }

    public function test_a_write_off_cannot_be_credited(): void
    {
        $binned = $this->writeOffBatch();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/inventory/disposals/{$binned['id']}/credit", [
                'credit_received' => 100, 'credit_received_at' => now()->toDateString(),
            ])->assertStatus(422);
    }

    public function test_a_credit_is_recorded_once(): void
    {
        // Every sibling in this codebase refuses the second one: a sale voids
        // once, an order cancels once, a coupon stops at its limit. This did
        // not check, and `StockDisposal::isCredited()` had sat unused since the
        // day it was written — the model stated the rule and nothing asked it.
        //
        // The screen was already right, which is what hid it: the button
        // disappears once the credit is recorded. The API is the contract, and
        // a retry or a double tap could replace a settled money figure with a
        // different one and reopen nothing.
        $sent = $this->returnBatch();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/inventory/disposals/{$sent['id']}/credit", [
                'credit_received' => 9500, 'credit_received_at' => now()->toDateString(),
            ])->assertOk();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/inventory/disposals/{$sent['id']}/credit", [
                'credit_received' => 3000, 'credit_received_at' => now()->toDateString(),
            ])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'ALREADY_CREDITED');

        // And the first figure is still the one on the row.
        $row = collect($this->actingAsUser($this->owner)
            ->getJson('/api/v1/inventory/disposals')->assertOk()->json('data'))
            ->firstWhere('id', $sent['id']);

        $this->assertEquals(9500, $row['credit_received']);
    }

    // ── The window that was timed to be useless ─────────────────────────

    public function test_a_pharmacy_is_warned_in_months_not_weeks(): void
    {
        // 30 days was the hardcoded window, and a distributor's return window
        // closes months before the printed date — so the one figure computed to
        // prevent this loss arrived after the claim had already been lost.
        $this->assertSame(90, ShopSettings::expiringSoonDays($this->pharmacy));
    }

    public function test_every_other_trade_keeps_thirty_days(): void
    {
        // A bakery warned ninety days out is warned about nothing.
        $mart = Tenant::factory()->create(['setup_completed' => true, 'business_type' => 'mart']);

        $this->assertSame(30, ShopSettings::expiringSoonDays($mart));
    }

    public function test_the_shop_can_set_its_own_distributor_s_terms(): void
    {
        $this->actingAsUser($this->owner)
            ->putJson('/api/v1/shop/settings', ['expiring_soon_days' => 180])->assertOk();

        $this->assertSame(180, ShopSettings::expiringSoonDays($this->pharmacy->fresh()));
    }

    public function test_the_expiring_screen_uses_that_window_rather_than_thirty(): void
    {
        // A lot 60 days out: invisible under the old hardcoded window, and it
        // is exactly the lot a pharmacist can still send back.
        $this->batch(qty: 20, expiry: '+60 days');

        $rows = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/inventory/expiring')->assertOk()->json('data');

        $this->assertCount(1, $rows);
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    /** @return array<string, mixed> */
    private function returnBatch(): array
    {
        $batch = $this->batch(qty: 40, cost: 300);

        return $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/inventory/batches/{$batch->id}", [
                'disposition' => 'returned_to_supplier', 'reason' => 'expired',
                'supplier_id' => $this->distributor->id, 'credit_expected' => 11000,
            ])->assertOk()->json('data');
    }

    /** @return array<string, mixed> */
    private function writeOffBatch(): array
    {
        $batch = $this->batch(qty: 5, cost: 100);

        return $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/inventory/batches/{$batch->id}", [
                'disposition' => 'written_off', 'reason' => 'expired',
            ])->assertOk()->json('data');
    }
}
