<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\City;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A medical store, from the day the shelf is empty to the day the books close.
 *
 * The other pharmacy suites each own one module — PharmacyDepthTest owns
 * substitution/register/recall, PharmacyEdgeCasesTest owns pack units and
 * variant lots, PrescriptionCaptureTest owns the Rx fields on a sale. Every one
 * of them starts with stock already on the shelf, put there by a factory.
 *
 * This file starts with an empty shop and a supplier's phone number, because
 * that is where the seams are. A chemist's day crosses six modules before the
 * first strip goes over the counter:
 *
 *   catalog → suppliers → purchase order → dated lot   (nothing enters undated)
 *   lot → POS                                           (the short-dated box goes first)
 *   lot → expiry screen → dashboard                     (what dies next month)
 *   catalog flags → POS → dashboard                     (a script, counted)
 *   POS → low stock                                     (at THIS shop's number)
 *   POS + expenses → cashbook                           (the fridge is not free)
 *   preset → counter                                    (who may do which of these)
 *   branch → receiving                                  (two shops, one shelf)
 *
 * The last of those found two live defects. Both are pinned below as the code
 * behaves TODAY, with the intended behaviour written above each — a red test
 * nobody can make green is deleted within a week, and then the bug is unwatched.
 *
 * Each test asserts on the FAR end of its chain and on a figure, never on the
 * presence of a row — a chemist whose expiry screen returns an envelope full of
 * nothing has the same screen as a chemist with no expired stock, and only one
 * of them is safe.
 */
class PharmacyTenantWalkthroughTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    // ── catalog → supplier → purchase order → dated lot ─────────────

    public function test_a_new_drug_is_carded_ordered_and_refused_entry_undated(): void
    {
        // The chain that fills an empty shelf. Four modules, and the thing being
        // proved at the end of it is a REFUSAL: a medicine that reaches stock
        // without an expiry date is invisible to FEFO and invisible to the
        // expired-stock fence, so it will be sold long after it should have been
        // destroyed. The guard has to sit on the receiving door, not on the
        // Batches screen where a careful pharmacist would have typed the date
        // anyway.
        [, $owner] = $this->shop();

        // 1. Card the drug. The five pharmacy columns are the whole reason a
        // medicine is not just a product: the salt is what a substitution is
        // found by, the schedule is what the till demands a script for.
        $med = $this->drug($owner, [
            'name' => 'Augmentin 625mg',
            'generic_name' => 'Amoxicillin + Clavulanic Acid',
            'strength' => '625mg',
            'dosage_form' => 'Tablet',
            'drug_schedule' => 'G',
            'requires_prescription' => true,
            'price' => 55,
            'cost' => 42,
            'low_stock_threshold' => 30,
        ]);

        // Read it back through the API the panel reads. A write that the catalog
        // accepts and the catalog cannot then show is the same as no write.
        $carded = $this->as($owner)->getJson("/api/v1/products/{$med['id']}")->assertOk()->json('data');

        $this->assertSame('Amoxicillin + Clavulanic Acid', $carded['generic_name'], 'The salt was not stored.');
        $this->assertSame('625mg', $carded['strength']);
        $this->assertSame('Tablet', $carded['dosage_form']);
        $this->assertSame('G', $carded['drug_schedule'], 'The regulator schedule was not stored.');
        $this->assertTrue((bool) $carded['requires_prescription']);
        $this->assertEquals(0, $carded['stock_quantity'], 'A carded drug is not stock — nothing has arrived yet.');

        // 2. The distributor, and the order placed with them.
        $supplier = $this->as($owner)->postJson('/api/v1/suppliers', [
            'name' => 'Sindh Medical Distributors', 'phone' => '+923004455667',
        ])->assertCreated()->json('data.id');

        $po = $this->as($owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier,
            'order_date' => now()->toDateString(),
            'status' => 'ordered',
            'items' => [['product_id' => $med['id'], 'quantity' => 200, 'unit_cost' => 42]],
        ])->assertCreated()->json('data');

        // 3. The delivery arrives and the boy at the back clicks "Receive all"
        // without opening the line. That is the request being made here — no
        // items map at all — and it must be refused for a medicine.
        $this->as($owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive")
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'EXPIRY_REQUIRED');

        // Refused means refused: no half-receipt. A guard that throws AFTER
        // moving stock leaves 200 undated tablets on the shelf and a purchase
        // order that says they never came.
        $this->assertEquals(
            0,
            Product::withoutTenancy()->findOrFail($med['id'])->stock_quantity,
            'A refused receipt still moved stock in.',
        );
        $this->assertSame(
            0,
            ProductBatch::withoutTenancy()->where('product_id', $med['id'])->count(),
            'A refused receipt still created a lot.',
        );
        $this->assertSame(
            'ordered',
            $this->as($owner)->getJson("/api/v1/purchase-orders/{$po['id']}")->assertOk()->json('data.status'),
            'A refused receipt still advanced the purchase order.',
        );

        // 4. Typed off the carton this time, and it lands.
        $this->as($owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [
            'items' => [[
                'id' => $po['items'][0]['id'],
                'quantity' => 200,
                'batch_number' => 'AMX-4471',
                'expiry_date' => now()->addYear()->toDateString(),
            ]],
        ])->assertOk();

        $this->assertEquals(
            200,
            Product::withoutTenancy()->findOrFail($med['id'])->stock_quantity,
            'A dated receipt did not move stock in.',
        );

        // The far end: the Batches screen the pharmacist actually looks at.
        // Receiving that writes stock but no lot is the bug that makes FEFO
        // quietly do nothing on purchased stock.
        $lots = collect($this->as($owner)
            ->getJson("/api/v1/inventory/products/{$med['id']}/batches")
            ->assertOk()->json('data'))->keyBy('batch_number');

        $this->assertArrayHasKey('AMX-4471', $lots, 'A received delivery never became a lot.');
        $this->assertEquals(200, $lots['AMX-4471']['quantity']);
        $this->assertSame(now()->addYear()->toDateString(), substr((string) $lots['AMX-4471']['expiry_date'], 0, 10));
    }

    // ── lot → POS ───────────────────────────────────────────────────

    public function test_the_short_dated_lot_is_the_one_that_leaves_the_shop(): void
    {
        // Two deliveries, and the one that expires SOONER arrived SECOND — the
        // ordinary case at a chemist, because a distributor ships whatever is
        // nearest their door. "First in" and "first to expire" therefore point
        // at different boxes, and a FIFO implementation passes every other
        // ordering test in this repo and destroys stock here.
        //
        // Received through purchase orders rather than the Batches screen: that
        // is the path real stock takes, and it is a different piece of code.
        [, $owner] = $this->shop();
        $med = $this->drug($owner, [
            'name' => 'Panadol 500mg',
            'generic_name' => 'Paracetamol',
            'strength' => '500mg',
            'dosage_form' => 'Tablet',
            'price' => 15,
            'cost' => 10,
        ]);

        $this->receiveDelivery($owner, $med['id'], 'LOT-FAR', qty: 100, expiry: now()->addYears(2), cost: 10);
        $this->receiveDelivery($owner, $med['id'], 'LOT-NEAR', qty: 100, expiry: now()->addMonths(2), cost: 10);

        $this->assertEquals(200, Product::withoutTenancy()->findOrFail($med['id'])->stock_quantity);

        // A customer buys 120 tablets — more than either lot holds on its own,
        // so the split is the assertion. The till never names a lot; the only
        // way this comes out right is if the sale path reads what the receiving
        // path wrote.
        $sale = $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $med['id'], 'quantity' => 120]],
            'payment_method' => 'cash',
            'amount_paid' => 1800,
        ])->assertCreated()->json('data');

        $this->assertEquals(1800, $sale['total'], 'The server priced 120 tablets at something other than 120 × 15.');

        $lots = collect($this->as($owner)
            ->getJson("/api/v1/inventory/products/{$med['id']}/batches")
            ->assertOk()->json('data'))->keyBy('batch_number');

        $this->assertEquals(0, $lots['LOT-NEAR']['quantity'], 'FEFO did not empty the short-dated lot first.');
        $this->assertEquals(80, $lots['LOT-FAR']['quantity'], 'The long-dated lot gave up the wrong amount.');
        $this->assertEquals(80, Product::withoutTenancy()->findOrFail($med['id'])->stock_quantity);
    }

    // ── lot → expiry screen → dashboard ─────────────────────────────

    public function test_the_shop_is_told_which_lots_are_about_to_die(): void
    {
        // Near-expiry is the one number a chemist can act on: a lot with three
        // weeks left can still be sold, returned to the distributor, or moved to
        // the front of the shelf. A lot with three weeks left that nobody is
        // told about becomes a write-off. Two places must agree — the Expiry
        // screen and the dashboard tile that sends you to it.
        [, $owner] = $this->shop();
        $med = $this->drug($owner, ['name' => 'Ventolin Inhaler', 'price' => 620, 'cost' => 500]);

        $this->addLot($owner, $med['id'], 'VEN-SOON', qty: 6, expiry: now()->addDays(20));
        $this->addLot($owner, $med['id'], 'VEN-LATER', qty: 30, expiry: now()->addDays(200));

        // The default window is 30 days. The lot 200 days out must NOT appear:
        // a screen that lists every lot you own is a screen nobody reads, and
        // then the one that mattered is lost in it.
        $soon = collect($this->as($owner)->getJson('/api/v1/inventory/expiring')->assertOk()->json('data'));

        $this->assertCount(1, $soon, 'The expiry screen listed lots that are nowhere near expiring.');
        $this->assertSame('VEN-SOON', $soon[0]['batch_number']);
        $this->assertEquals(6, $soon[0]['quantity'], 'The expiry screen reported the wrong quantity at risk.');
        $this->assertFalse($soon[0]['expired'], 'A lot with 20 days left was reported as already dead.');

        // Widen the window and the second lot joins it — proof the window is a
        // real filter and not a coincidence of having one lot.
        $this->assertCount(
            2,
            $this->as($owner)->getJson('/api/v1/inventory/expiring?days=365')->assertOk()->json('data'),
            'Widening the window to a year did not reach the lot 200 days out.',
        );

        // The far end: the tile on the dashboard. It is computed separately
        // from the screen above, so the two drifting apart is a live risk.
        $dash = $this->as($owner)->getJson('/api/v1/dashboard')->assertOk()->json('data');

        $this->assertSame(1, $dash['expiring_soon_count'], 'The dashboard did not count the lot about to expire.');
        $this->assertSame(1, $dash['inventory']['expiring_soon']);
    }

    public function test_stock_that_has_expired_is_fenced_off_from_the_till(): void
    {
        // The lot above, three weeks later. Nothing was done about it, and now
        // it is the shop's job to make sure it cannot be handed to a patient.
        // stock_quantity still says 36 — the quantity is real, it is sitting on
        // the shelf — and 6 of it is unsellable. A till that trusts the rollup
        // dispenses expired medicine.
        [, $owner] = $this->shop();
        $med = $this->drug($owner, ['name' => 'Ventolin Inhaler', 'price' => 620, 'cost' => 500]);

        $this->addLot($owner, $med['id'], 'VEN-SOON', qty: 6, expiry: now()->addDays(20));
        $this->addLot($owner, $med['id'], 'VEN-LATER', qty: 30, expiry: now()->addDays(200));

        $this->travel(40)->days();

        $this->assertEquals(36, Product::withoutTenancy()->findOrFail($med['id'])->stock_quantity);

        // 31 is one more than the live lot holds, so the last unit would have to
        // come out of the dead one. Refused — by error CODE, because the panel
        // switches on that and not on the sentence.
        $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $med['id'], 'quantity' => 31]],
            'payment_method' => 'cash',
            'amount_paid' => 19220,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'STOCK_EXPIRED');

        // Everything inside the live lot still sells. The fence must cost the
        // shop the expired stock and nothing else.
        $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $med['id'], 'quantity' => 30]],
            'payment_method' => 'cash',
            'amount_paid' => 18600,
        ])->assertCreated();

        $lots = collect($this->as($owner)
            ->getJson("/api/v1/inventory/products/{$med['id']}/batches")
            ->assertOk()->json('data'))->keyBy('batch_number');

        $this->assertEquals(0, $lots['VEN-LATER']['quantity'], 'The live lot was not the one that sold.');
        $this->assertEquals(6, $lots['VEN-SOON']['quantity'], 'Expired stock was dispensed.');

        // And it is still on the expiry screen, now flagged dead, so the
        // pharmacist can pull and destroy it. Silently hiding expired lots is
        // how they stay on a shelf.
        $listed = collect($this->as($owner)->getJson('/api/v1/inventory/expiring')->assertOk()->json('data'))
            ->firstWhere('batch_number', 'VEN-SOON');

        $this->assertNotNull($listed, 'An expired lot fell off the expiry screen.');
        $this->assertTrue($listed['expired']);
        $this->assertEquals(6, $listed['quantity']);
    }

    // ── catalog flags → POS → dashboard ─────────────────────────────

    public function test_a_scheduled_drug_needs_its_script_and_then_reaches_the_dispensing_block(): void
    {
        // Two seams in one chain. First: a flag typed into the CATALOG has to
        // change what the TILL will accept — a schedule that only decorates the
        // product page is worthless. Second: the script the counter recorded has
        // to reach the dashboard block a chemist opens the app for, which is a
        // different module reading the sale.
        [, $owner] = $this->shop();
        $med = $this->drug($owner, [
            'name' => 'Morphine 10mg',
            'generic_name' => 'Morphine',
            'strength' => '10mg',
            'dosage_form' => 'Tablet',
            'drug_schedule' => 'G',
            'requires_prescription' => true,
            'price' => 450,
            'cost' => 300,
            'stock_quantity' => 20,
            'expiry_date' => now()->addYear()->toDateString(),
        ]);

        // Nobody wrote down who prescribed it. The till says no.
        $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $med['id'], 'quantity' => 2]],
            'payment_method' => 'cash',
            'amount_paid' => 900,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PRESCRIPTION_REQUIRED');

        $sale = $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $med['id'], 'quantity' => 2]],
            'payment_method' => 'cash',
            'amount_paid' => 900,
            'prescription_number' => 'RX-4471',
            'prescriber_name' => 'Dr Farooq Ahmed',
            'patient_name' => 'Bilal Ahmed',
        ])->assertCreated()->json('data');

        $this->assertSame('RX-4471', $sale['prescription_number']);
        $this->assertSame('Bilal Ahmed', $sale['patient_name']);
        $this->assertEquals(900, $sale['total']);

        // Sell something over the counter too. The dispensing block answers "how
        // much of today was scripts", so shampoo money leaking into it is the
        // failure worth guarding — an inflated Rx figure is the one number an
        // inspector asks a pharmacist to stand behind.
        $shampoo = $this->drug($owner, [
            'name' => 'Head & Shoulders 200ml', 'price' => 700, 'cost' => 520,
            'item_type' => 'physical_product', 'stock_quantity' => 10,
        ]);
        $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $shampoo['id'], 'quantity' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => 700,
        ])->assertCreated();

        $rx = $this->as($owner)->getJson('/api/v1/dashboard')->assertOk()->json('data.dispensing');

        $this->assertNotNull($rx, 'A medical store was not asked about its scripts at all.');
        $this->assertSame(1, $rx['rx_sales'], 'The script never reached the dispensing block.');
        $this->assertEquals(900, $rx['rx_revenue'], 'Over-the-counter money was counted as dispensing.');
        $this->assertSame(1, $rx['prescribers']);
    }

    // ── POS → low stock ─────────────────────────────────────────────

    public function test_low_stock_uses_the_number_this_shop_set_and_not_a_hardcoded_one(): void
    {
        // A chemist sets reorder levels by how fast a line moves and how long
        // the distributor takes: an insulin at 7, a strip of Disprin at 2. The
        // trap this guards is a threshold that looks configurable on the product
        // form and is ignored by the report, which then warns about everything
        // under some fixed number — the pharmacist stops reading it inside a
        // week, and the line that actually ran out is in there somewhere.
        [, $owner] = $this->shop();

        $insulin = $this->drug($owner, [
            'name' => 'Lantus SoloStar', 'price' => 2400, 'cost' => 1900,
            'stock_quantity' => 10, 'low_stock_threshold' => 7,
            'expiry_date' => now()->addYear()->toDateString(),
        ]);
        // Deliberately BELOW any plausible hardcoded default (10, 5) and above
        // its own threshold. If the report ignores the shop's number, this is
        // the row that gives it away.
        $disprin = $this->drug($owner, [
            'name' => 'Disprin 300mg', 'price' => 30, 'cost' => 22,
            'stock_quantity' => 6, 'low_stock_threshold' => 2,
            'expiry_date' => now()->addYear()->toDateString(),
        ]);

        // Nothing is low yet — 10 > 7 and 6 > 2.
        $this->assertCount(
            0,
            $this->as($owner)->getJson('/api/v1/inventory/low-stock')->assertOk()->json('data'),
            'A shop with everything above its own reorder level was warned anyway.',
        );

        // Three pens go out, which lands the insulin EXACTLY on 7. "At the
        // threshold" is the boundary a shopkeeper means when they type it —
        // a strict `<` would only warn once they were already short.
        $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $insulin['id'], 'quantity' => 3]],
            'payment_method' => 'cash',
            'amount_paid' => 7200,
        ])->assertCreated();

        $low = collect($this->as($owner)->getJson('/api/v1/inventory/low-stock')->assertOk()->json('data'));

        $this->assertCount(1, $low, 'The low-stock list is not being drawn at each item’s own threshold.');
        $this->assertSame($insulin['id'], $low[0]['id']);
        $this->assertEquals(7, $low[0]['stock_quantity']);
        $this->assertEquals(7, $low[0]['low_stock_threshold'], 'The threshold the shop set is not the one being used.');
        $this->assertNotContains($disprin['id'], $low->pluck('id')->all(), 'A line above its own reorder level was flagged.');
    }

    // ── POS + expenses → cashbook ───────────────────────────────────

    public function test_the_fridge_bill_lands_in_the_books_beside_the_days_takings(): void
    {
        // A medical store's largest fixed cost is not rent, it is the cold
        // chain — the fridge that keeps insulin and vaccines alive runs all
        // night. Two modules write into one report here, and the report is what
        // the owner believes: a day that shows takings and not the electricity
        // bill reads as a profitable day.
        [, $owner] = $this->shop();
        $med = $this->drug($owner, [
            'name' => 'Insulin Actrapid', 'price' => 1100, 'cost' => 850,
            'stock_quantity' => 12, 'expiry_date' => now()->addMonths(9)->toDateString(),
        ]);

        $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $med['id'], 'quantity' => 4]],
            'payment_method' => 'cash',
            'amount_paid' => 4400,
        ])->assertCreated();

        $category = $this->as($owner)->postJson('/api/v1/expense-categories', [
            'name' => 'Refrigerator Electricity',
        ])->assertCreated()->json('data.id');

        $this->as($owner)->postJson('/api/v1/expenses', [
            'expense_category_id' => $category,
            'description' => 'K-Electric bill — cold chain',
            'amount' => 12000,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'cash',
        ])->assertCreated();

        // The cashbook emits one row per day in the range whether the shop
        // opened or not, so the row existing proves nothing. The figures on
        // today's row are the assertion.
        $days = collect($this->as($owner)->getJson('/api/v1/cashbook?'.http_build_query([
            'from' => now()->subDay()->toDateString(),
            'to' => now()->addDay()->toDateString(),
        ]))->assertOk()->json('data.days'));

        $today = $days->firstWhere('date', now()->toDateString());

        $this->assertNotNull($today, 'Today is missing from the cashbook.');
        $this->assertEquals(4400, $today['sales_revenue'], 'The counter takings never reached the books.');
        $this->assertEquals(12000, $today['expenses'], 'The fridge bill never reached the books.');
        // PKR, and negative: this shop paid a quarter's electricity today.
        $this->assertEquals(-7600, $today['net']);
    }

    // ── preset → counter ────────────────────────────────────────────

    public function test_a_counter_hand_can_dispense_and_find_a_substitute_without_the_stockroom_keys(): void
    {
        // The PERSON axis. A medical store rarely has the pharmacist on the till
        // all day; a counter hand rings the sale and calls them over for the
        // judgement. So the cashier preset has to be able to do the counter's
        // whole job — and no more.
        //
        // The bug class being guarded is a READ gated behind a `*.manage` write
        // permission: the counter needs to LOOK at the catalog and at what else
        // carries the same salt, and neither of those is permission to reprice
        // the shop or to open a lot.
        [$shop, $owner] = $this->shop();

        $panadol = $this->drug($owner, [
            'name' => 'Panadol 500mg', 'generic_name' => 'Paracetamol',
            'strength' => '500mg', 'dosage_form' => 'Tablet', 'price' => 15, 'cost' => 10,
        ]);
        $calpol = $this->drug($owner, [
            'name' => 'Calpol 500mg', 'generic_name' => 'Paracetamol',
            'strength' => '500mg', 'dosage_form' => 'Tablet', 'price' => 18, 'cost' => 12,
            'stock_quantity' => 60, 'expiry_date' => now()->addYear()->toDateString(),
        ]);
        $amoxil = $this->drug($owner, [
            'name' => 'Amoxil 500mg', 'generic_name' => 'Amoxicillin',
            'strength' => '500mg', 'dosage_form' => 'Capsule', 'price' => 120, 'cost' => 90,
            'requires_prescription' => true,
            'stock_quantity' => 30, 'expiry_date' => now()->addYear()->toDateString(),
        ]);

        $counter = User::factory()
            ->tenantStaff($shop, StaffPresets::permissionsFor('cashier'))
            ->create(['name' => 'Sana']);

        // The till grid. A 403 here draws an EMPTY product list in the panel,
        // which reads to a shopkeeper as "this shop has no medicines".
        $grid = $this->as($counter)->getJson('/api/v1/products');
        $this->assertSame(200, $grid->status(), 'The counter was refused the catalog it sells from.');
        $this->assertContains('Calpol 500mg', array_column($grid->json('data'), 'name'));

        // Panadol is out. "What else has the same salt?" is asked across the
        // counter twenty times a day and answered by the person standing at it.
        $alt = $this->as($counter)->getJson("/api/v1/pharmacy/alternatives?product_id={$panadol['id']}");
        $this->assertSame(200, $alt->status(), 'The counter was refused the substitution lookup.');
        $this->assertSame(
            'Calpol 500mg',
            $alt->json('data.alternatives.0.name'),
            'The equivalent on the shelf was not offered.',
        );

        // And the sale itself, script recorded.
        $sale = $this->as($counter)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $amoxil['id'], 'quantity' => 6]],
            'payment_method' => 'cash',
            'amount_paid' => 720,
            'prescription_number' => 'RX-8812',
            'prescriber_name' => 'Dr Ayesha Khan',
            'patient_name' => 'Usman Tariq',
        ])->assertCreated()->json('data');

        $this->assertEquals(720, $sale['total']);
        $this->assertEquals(24, Product::withoutTenancy()->findOrFail($amoxil['id'])->stock_quantity);
        $this->assertSame('RX-8812', $sale['prescription_number'], 'The counter’s script was not recorded.');

        // The boundary the reads above must not have crossed. Booking in a lot
        // and answering a manufacturer's recall are stockroom work; if a fix for
        // the read-vs-manage bug takes the lazy path and grants inventory.manage,
        // these two stop failing and nobody notices for months.
        $this->as($counter)->postJson("/api/v1/inventory/products/{$calpol['id']}/batches", [
            'batch_number' => 'GHOST', 'quantity' => 100,
            'expiry_date' => now()->addYear()->toDateString(),
        ])->assertForbidden();

        $this->as($counter)->getJson('/api/v1/pharmacy/recall?batch_number=GHOST')->assertForbidden();
    }

    // ── branch → receiving (a chemist with two shops) ────────────────

    /**
     * BUG, pinned as it behaves today.
     *
     * A second shop books its own delivery in and the stock appears on the
     * FIRST shop's shelf. Both receiving paths — the Batches screen and a
     * purchase-order receipt — write the lot and the stock movement against
     * `is_default = true` instead of the branch the user is operating in
     * (BatchController::store, ReceivePurchaseOrderAction::execute; the
     * inventory adjust is called with no branch_id, which defaults to Main).
     *
     * What it costs a shopkeeper: the boxes are physically at Gulberg, the till
     * at Gulberg refuses to sell them ("only 0 in stock") while the product page
     * cheerfully shows 20 in stock, and the expiry/FEFO lot is dated against a
     * shelf in a different part of the city. The only workaround is a stock
     * transfer for goods that never moved.
     *
     * SHOULD BE: the operating branch (BranchContext) receives, exactly as the
     * sale path already decrements it — see BranchScopedReadsTest, where a sale
     * under X-Branch-Id lands on that branch.
     */
    public function test_a_second_shop_books_in_a_delivery_and_the_stock_lands_there(): void
    {
        [$shop, $owner] = $this->shop();
        $main = Branch::withoutTenancy()->where('tenant_id', $shop->id)->where('is_default', true)->firstOrFail();
        $gulberg = Branch::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);

        $med = $this->drug($owner, ['name' => 'Brufen 400mg', 'price' => 40, 'cost' => 30]);

        $supplier = $this->as($owner)->withHeaders(['X-Branch-Id' => $gulberg->id])
            ->postJson('/api/v1/suppliers', ['name' => 'Gulberg Distributor'])
            ->assertCreated()->json('data.id');

        $po = $this->as($owner)->withHeaders(['X-Branch-Id' => $gulberg->id])
            ->postJson('/api/v1/purchase-orders', [
                'supplier_id' => $supplier,
                'order_date' => now()->toDateString(),
                'status' => 'ordered',
                'items' => [['product_id' => $med['id'], 'quantity' => 20, 'unit_cost' => 30]],
            ])->assertCreated()->json('data');

        // Received standing in the Gulberg shop, with the branch header set.
        $this->as($owner)->withHeaders(['X-Branch-Id' => $gulberg->id])
            ->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [
                'items' => [[
                    'id' => $po['items'][0]['id'],
                    'quantity' => 20,
                    'batch_number' => 'BRF-2291',
                    'expiry_date' => now()->addYear()->toDateString(),
                ]],
            ])->assertOk();

        // The tenant-wide rollup is right — 20 boxes exist somewhere.
        $this->assertEquals(
            20,
            Product::withoutTenancy()->findOrFail($med['id'])->stock_quantity,
            'The delivery never reached the shop at all.',
        );

        // …and they are on the right shelf. The LOT matters as much as the
        // count here: FEFO reads lots, so a lot filed at the wrong branch makes
        // the dispensing counter pick from stock it does not hold.
        $this->assertSame(
            $gulberg->id,
            ProductBatch::withoutTenancy()->where('batch_number', 'BRF-2291')->value('branch_id'),
            'The lot was filed against a branch that never took the delivery.',
        );
        $this->assertEquals(
            20,
            BranchStock::withoutTenancy()->where('branch_id', $gulberg->id)->where('product_id', $med['id'])->value('quantity'),
            'The branch that received the goods does not hold them.',
        );
        // Zero rather than absent: the shelf row may exist from an earlier
        // touch. What matters is that none of this delivery landed on it.
        $this->assertEquals(
            0,
            BranchStock::withoutTenancy()->where('branch_id', $main->id)->where('product_id', $med['id'])->value('quantity') ?? 0,
            'Main was credited with a delivery it never took.',
        );

        // The consequence, at the counter where it actually mattered: the shop
        // can sell what is sitting in front of the cashier.
        $this->as($owner)->withHeaders(['X-Branch-Id' => $gulberg->id])
            ->postJson('/api/v1/sales', [
                'channel' => 'pos',
                'items' => [['product_id' => $med['id'], 'quantity' => 1]],
                'payment_method' => 'cash',
                'amount_paid' => 40,
            ])
            ->assertCreated();
    }

    /**
     * BUG, pinned as it behaves today.
     *
     * The expiry TILE on the dashboard is branch-scoped
     * (DashboardService::expiringSoonCount filters on branch_id); the expiry
     * SCREEN it links to (BatchController::expiring) is not scoped at all. At a
     * two-shop chemist the tile says one number and the page it opens shows a
     * different one, which is how a shopkeeper learns to stop believing the
     * dashboard.
     *
     * SHOULD BE: both branch-scoped, or both tenant-wide — but the same.
     */
    public function test_the_expiry_tile_and_the_expiry_screen_agree_across_branches(): void
    {
        [$shop, $owner] = $this->shop();
        $gulberg = Branch::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);
        $med = $this->drug($owner, ['name' => 'Augmentin Syrup', 'price' => 380, 'cost' => 300]);

        // Lands at Main (the bug above); either way it is not Gulberg's stock.
        $this->addLot($owner, $med['id'], 'AUG-SOON', qty: 8, expiry: now()->addDays(15));

        $screen = $this->as($owner)->withHeaders(['X-Branch-Id' => $gulberg->id])
            ->getJson('/api/v1/inventory/expiring')->assertOk()->json('data');
        $tile = $this->as($owner)->withHeaders(['X-Branch-Id' => $gulberg->id])
            ->getJson('/api/v1/dashboard')->assertOk()->json('data.expiring_soon_count');

        // The tile and the screen it links to answer the same question. Fixed
        // 2026-08-10: the tile was branch-scoped and the screen was not, so a
        // pharmacist stood in Gulberg reading "0 expiring soon" and opened a
        // list of lots about to die. Neither number was actionable, because
        // there was no way to tell which one was about this shop.
        $this->assertCount(0, $screen, 'The expiry screen still ignores the branch.');
        $this->assertSame(0, $tile);
        $this->assertSame(count($screen), $tile, 'The tile and the screen disagree about the same branch.');

        // And from the branch that actually holds the lot, both find it. Named
        // explicitly rather than relying on which branch an unheadered request
        // resolves to — that default is ResolveBranch's business, not this
        // test's.
        $holder = ProductBatch::withoutTenancy()->where('batch_number', 'AUG-SOON')->value('branch_id');

        $atHolder = $this->as($owner)->withHeaders(['X-Branch-Id' => $holder])
            ->getJson('/api/v1/inventory/expiring')->assertOk()->json('data');
        $tileAtHolder = $this->as($owner)->withHeaders(['X-Branch-Id' => $holder])
            ->getJson('/api/v1/dashboard')->assertOk()->json('data.expiring_soon_count');

        $this->assertCount(1, $atHolder, 'The lot vanished from the branch that holds it.');
        $this->assertEquals(8, $atHolder[0]['quantity']);
        $this->assertSame(count($atHolder), $tileAtHolder, 'The tile and the screen disagree where the stock is.');
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /** @return array{0: Tenant, 1: User} */
    private function shop(): array
    {
        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);

        $shop = Tenant::factory()->create([
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'pharmacy',
            'features' => BusinessTypes::defaultFeatures('pharmacy'),
            'timezone' => 'UTC',
        ]);

        return [$shop, User::factory()->shopOwner($shop)->create()];
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /**
     * Card a drug through the same endpoint the panel posts to — never straight
     * into the table, because half of what is being walked here is whether the
     * catalog's own validation and the till agree about the same product.
     *
     * @return array<string, mixed> the created product payload
     */
    private function drug(User $owner, array $attrs): array
    {
        return $this->as($owner)->postJson('/api/v1/products', array_merge([
            'item_type' => 'medicine',
            'track_inventory' => true,
        ], $attrs))->assertCreated()->json('data');
    }

    /** A whole delivery: order it, then book it in against a dated lot. */
    private function receiveDelivery(
        User $owner,
        string $productId,
        string $lot,
        float $qty,
        \DateTimeInterface $expiry,
        float $cost,
    ): void {
        $supplier = $this->as($owner)->postJson('/api/v1/suppliers', [
            'name' => 'Distributor '.$lot,
        ])->assertCreated()->json('data.id');

        $po = $this->as($owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier,
            'order_date' => now()->toDateString(),
            'status' => 'ordered',
            'items' => [['product_id' => $productId, 'quantity' => $qty, 'unit_cost' => $cost]],
        ])->assertCreated()->json('data');

        $this->as($owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [
            'items' => [[
                'id' => $po['items'][0]['id'],
                'quantity' => $qty,
                'batch_number' => $lot,
                'expiry_date' => $expiry->format('Y-m-d'),
            ]],
        ])->assertOk();
    }

    /** A lot entered by hand on the Batches screen (opening stock, a return). */
    private function addLot(User $owner, string $productId, string $lot, float $qty, \DateTimeInterface $expiry): void
    {
        $this->as($owner)->postJson("/api/v1/inventory/products/{$productId}/batches", [
            'batch_number' => $lot,
            'quantity' => $qty,
            'expiry_date' => $expiry->format('Y-m-d'),
        ])->assertCreated();
    }
}
