<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductSerial;
use App\Models\SaleItemSerial;
use App\Models\SaleReturn;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\UnitsBackOnTheShelf;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A UNIT IS SOLD BY ITS NUMBER — AND COMES BACK BY IT.
 *
 * A phone shop writes a number down three times: when the box arrives, when
 * it is sold, and when it comes back. The first two were built and tested.
 * The third was built on the server and offered by NO SCREEN — the returns
 * desk sent a quantity and never a number — so, for every shop:
 *
 *   a refunded phone stayed `sold` in the registry: on the shelf, and refused
 *   at the till as "already sold"
 *
 *   the warranty desk went on reading "Under warranty — 365.9999999999884
 *   days left" for a unit the customer had handed back that afternoon
 *
 *   an exchange — the commonest reason a phone comes back — could not say
 *   which unit came in or which went out
 *
 * and a cashier who scanned the IMEI on the box was told "no item found".
 */
class AUnitIsSoldByItsNumberTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $phone;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop('UTC');
    }

    private function shop(string $timezone): void
    {
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'), 'timezone' => $timezone,
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->phone = $this->item('Galaxy A55');
    }

    private function item(string $name, int $stock = 0): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => 50000, 'cost' => 40000, 'stock_quantity' => $stock,
            'track_inventory' => true, 'tracks_serial' => true, 'warranty_months' => 12,
        ]);
    }

    private function req(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** Goods in: $serials arrive on an order, with $extra more units that have no number. */
    private function receive(array $serials, int $extra = 0, ?Product $product = null): TestResponse
    {
        $product ??= $this->phone;
        $supplierId = $this->req()->postJson('/api/v1/suppliers', ['name' => 'Distributor '.uniqid()])->json('data.id');
        $po = $this->req()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplierId, 'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [['product_id' => $product->id, 'quantity' => count($serials) + $extra, 'unit_cost' => 40000]],
        ])->json('data');

        return $this->req()->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [
            'items' => [['id' => $po['items'][0]['id'], 'quantity' => count($serials) + $extra, 'serials' => $serials]],
        ]);
    }

    /** One line of phones: $serials named, $unnumbered more with no number. */
    private function sell(array $serials, int $unnumbered = 0): TestResponse
    {
        $qty = count($serials) + $unnumbered;

        return $this->req()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 50000 * $qty,
            'customer_name' => 'Hamza', 'customer_phone' => '03001230001',
            'items' => [['product_id' => $this->phone->id, 'quantity' => $qty, 'serials' => $serials]],
        ]);
    }

    private function bringBack(array $sale, int $qty, ?array $serials = null): TestResponse
    {
        $row = ['sale_item_id' => $sale['items'][0]['id'], 'quantity' => $qty];
        if ($serials !== null) {
            $row['serials'] = $serials;
        }

        return $this->req()->postJson("/api/v1/sales/{$sale['id']}/returns", ['items' => [$row]]);
    }

    private function registry(string $serial): ?ProductSerial
    {
        return ProductSerial::withoutTenancy()->where('serial', $serial)->first();
    }

    private function sold(string $serial): SaleItemSerial
    {
        return SaleItemSerial::withoutTenancy()->where('serial', $serial)->latest('sold_at')->latest('id')->firstOrFail();
    }

    private function stock(): float
    {
        return (float) Product::withoutTenancy()->find($this->phone->id)->stock_quantity;
    }

    private function lookup(string $serial): TestResponse
    {
        return $this->req()->getJson('/api/v1/warranty/lookup?serial='.urlencode($serial));
    }

    // ── it comes back by its number ──────────────────────────────────

    public function test_the_only_phone_on_a_bill_comes_back_and_its_number_is_free_without_being_asked_for(): void
    {
        $this->receive(['IMEI-1'])->assertOk();
        $sale = $this->sell(['IMEI-1'])->assertCreated()->json('data');
        $this->assertSame('sold', $this->registry('IMEI-1')->status);

        // The returns desk as it was: a quantity, and no number.
        $this->bringBack($sale, 1)->assertCreated();

        $this->assertSame('in_stock', $this->registry('IMEI-1')->status);
        $this->assertNull($this->registry('IMEI-1')->sale_id);
        $this->assertNotNull($this->sold('IMEI-1')->returned_at);
        $this->assertSame(1.0, $this->stock());

        // On the shelf, and sellable under the same number.
        $this->sell(['IMEI-1'])->assertCreated();
    }

    public function test_one_of_two_comes_back_and_the_shop_must_say_which(): void
    {
        $this->receive(['IMEI-1', 'IMEI-2'])->assertOk();
        $sale = $this->sell(['IMEI-1', 'IMEI-2'])->assertCreated()->json('data');

        $this->bringBack($sale, 1)
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'RETURN_SERIAL_REQUIRED');

        // Refused whole: no money back, nothing on the shelf, no return on file.
        $this->assertSame(0.0, $this->stock());
        $this->assertSame(0, SaleReturn::withoutTenancy()->count());
        $this->assertSame('sold', $this->registry('IMEI-1')->status);
        $this->assertSame('sold', $this->registry('IMEI-2')->status);
    }

    public function test_the_one_named_is_the_one_that_is_free_and_the_last_one_needs_no_naming(): void
    {
        $this->receive(['IMEI-1', 'IMEI-2'])->assertOk();
        $sale = $this->sell(['IMEI-1', 'IMEI-2'])->assertCreated()->json('data');

        $this->bringBack($sale, 1, ['IMEI-2'])->assertCreated();
        $this->assertSame('in_stock', $this->registry('IMEI-2')->status);
        $this->assertSame('sold', $this->registry('IMEI-1')->status);
        $this->assertNull($this->sold('IMEI-1')->returned_at);

        // The other one, later. It is the only unit left on the line.
        $this->bringBack($sale, 1)->assertCreated();
        $this->assertSame('in_stock', $this->registry('IMEI-1')->status);
        $this->assertNotNull($this->sold('IMEI-1')->returned_at);
    }

    public function test_both_come_back_and_naming_one_of_them_frees_both(): void
    {
        $this->receive(['IMEI-1', 'IMEI-2'])->assertOk();
        $sale = $this->sell(['IMEI-1', 'IMEI-2'])->assertCreated()->json('data');

        $this->bringBack($sale, 2, ['IMEI-1'])->assertCreated();

        $this->assertSame('in_stock', $this->registry('IMEI-1')->status);
        $this->assertSame('in_stock', $this->registry('IMEI-2')->status);
    }

    public function test_two_of_three_come_back_and_one_name_is_not_enough(): void
    {
        $this->receive(['A', 'B', 'C'])->assertOk();
        $sale = $this->sell(['A', 'B', 'C'])->assertCreated()->json('data');

        $this->bringBack($sale, 2, ['A'])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'RETURN_SERIAL_COUNT_MISMATCH');
        $this->assertSame('sold', $this->registry('A')->status);

        // More names than units is refused the same way.
        $this->bringBack($sale, 1, ['A', 'B'])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'RETURN_SERIAL_COUNT_MISMATCH');

        $this->bringBack($sale, 2, ['A', 'C'])->assertCreated();
        $this->assertSame('in_stock', $this->registry('A')->status);
        $this->assertSame('sold', $this->registry('B')->status);
        $this->assertSame('in_stock', $this->registry('C')->status);
    }

    public function test_a_unit_sold_with_no_number_can_come_back_without_one(): void
    {
        // Two on the bill: one by its number, one that never had it written down.
        $this->receive(['IMEI-1'], extra: 1)->assertOk();
        $sale = $this->sell(['IMEI-1'], unnumbered: 1)->assertCreated()->json('data');

        // The unnumbered one comes back. Nothing to name, and nothing is freed.
        $this->bringBack($sale, 1, [])->assertCreated();
        $this->assertSame('sold', $this->registry('IMEI-1')->status);
        $this->assertNull($this->sold('IMEI-1')->returned_at);

        // Now the numbered one is the only unit left: it needs no naming.
        $this->bringBack($sale, 1)->assertCreated();
        $this->assertSame('in_stock', $this->registry('IMEI-1')->status);
    }

    public function test_a_number_that_was_only_ever_typed_at_the_till_is_written_down_when_the_unit_comes_back(): void
    {
        // Opening stock: on the shelf, never received by number.
        Product::withoutTenancy()->whereKey($this->phone->id)->update(['stock_quantity' => 1]);
        $sale = $this->sell(['TYPED-1'])->assertCreated()->json('data');
        $this->assertNull($this->registry('TYPED-1'), 'a typed number has no registry row until it comes back');

        $this->bringBack($sale, 1)->assertCreated();

        $held = $this->registry('TYPED-1');
        $this->assertNotNull($held, 'the returned unit is on the shelf with no number against it');
        $this->assertSame('in_stock', $held->status);
        $this->assertSame('sale_return', $held->source);
        $this->assertSame($this->phone->id, $held->product_id);

        // The till's list of units on the shelf now offers it.
        $offered = $this->req()->getJson("/api/v1/products/{$this->phone->id}/serials?status=in_stock")->json('data');
        $this->assertSame(['TYPED-1'], array_column($offered, 'serial'));

        // The sale's own record of the unit points at the row it now has.
        $this->assertSame($held->id, $this->sold('TYPED-1')->product_serial_id);

        // Sold again, and back again: one row, not two.
        $again = $this->sell(['TYPED-1'])->assertCreated()->json('data');
        $this->assertSame('sold', $this->registry('TYPED-1')->status);
        $this->bringBack($again, 1)->assertCreated();
        $this->assertSame(1, ProductSerial::withoutTenancy()->where('serial', 'TYPED-1')->count());
        $this->assertSame('in_stock', $this->registry('TYPED-1')->status);
    }

    public function test_the_same_number_arrived_on_an_order_while_the_unit_was_out_and_the_return_still_goes_through(): void
    {
        // Sold from opening stock by a typed number…
        Product::withoutTenancy()->whereKey($this->phone->id)->update(['stock_quantity' => 1]);
        $sale = $this->sell(['X-77'])->assertCreated()->json('data');
        // …and then that number is written down at goods-in.
        $this->receive(['X-77'])->assertOk();
        $this->assertSame(1, ProductSerial::withoutTenancy()->where('serial', 'X-77')->count());

        $this->bringBack($sale, 1)->assertCreated();

        // One row, on the shelf — and the sale's own record points at it.
        $this->assertSame(1, ProductSerial::withoutTenancy()->where('serial', 'X-77')->count());
        $this->assertSame('in_stock', $this->registry('X-77')->status);
        $this->assertSame($this->registry('X-77')->id, $this->sold('X-77')->product_serial_id);
        // What it arrived as is not rewritten by its coming back.
        $this->assertSame('purchase_order', $this->registry('X-77')->source);
    }

    // ── an exchange says which came in and which went out ────────────

    public function test_an_exchange_takes_one_number_in_and_sends_another_out(): void
    {
        $this->receive(['IMEI-1', 'IMEI-2'])->assertOk();
        $sale = $this->sell(['IMEI-1'])->assertCreated()->json('data');

        $swap = $this->req()->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1, 'serials' => ['IMEI-1']]],
            'items' => [['product_id' => $this->phone->id, 'quantity' => 1, 'serials' => ['IMEI-2'], 'warranty_months' => 6]],
            'payments' => [],
            'channel' => 'walk_in',
        ])->assertCreated()->json('data');

        // The faulty unit is the shop's again…
        $this->assertSame('in_stock', $this->registry('IMEI-1')->status);
        $this->assertNotNull($this->sold('IMEI-1')->returned_at);

        // …and the one that went out is on the new bill, by its number, with its own cover.
        $this->assertSame('sold', $this->registry('IMEI-2')->status);
        $out = $this->sold('IMEI-2');
        $this->assertSame($swap['sale']['id'], $out->sale_id);
        $this->assertSame(6, $out->warranty_months);

        $this->lookup('IMEI-2')->assertOk()->assertJsonPath('data.under_warranty', true);
        $this->lookup('IMEI-1')->assertOk()
            ->assertJsonPath('data.under_warranty', false)
            ->assertJsonPath('data.came_back.as', 'returned');
    }

    public function test_one_of_two_is_exchanged_and_the_exchange_says_which(): void
    {
        $this->receive(['IMEI-1', 'IMEI-2', 'IMEI-3'])->assertOk();
        $sale = $this->sell(['IMEI-1', 'IMEI-2'])->assertCreated()->json('data');
        $swap = fn (array $back) => $this->req()->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1] + $back],
            'items' => [['product_id' => $this->phone->id, 'quantity' => 1, 'serials' => ['IMEI-3']]],
            'payments' => [],
            'channel' => 'walk_in',
        ]);

        // Not said: refused whole. Nothing came in, and nothing went out.
        $swap([])->assertStatus(422)->assertJsonPath('meta.error_code', 'RETURN_SERIAL_REQUIRED');
        $this->assertSame('in_stock', $this->registry('IMEI-3')->status);
        $this->assertSame('sold', $this->registry('IMEI-2')->status);

        $swap(['serials' => ['IMEI-2']])->assertCreated();
        $this->assertSame('in_stock', $this->registry('IMEI-2')->status);
        $this->assertSame('sold', $this->registry('IMEI-1')->status);
        $this->assertSame('sold', $this->registry('IMEI-3')->status);
        $this->assertNull($this->sold('IMEI-1')->returned_at);
    }

    // ── the warranty desk ────────────────────────────────────────────

    public function test_the_days_left_are_a_number_of_days(): void
    {
        $this->travelTo('2026-03-10 10:00:00');
        $this->receive(['IMEI-1'])->assertOk();
        $this->sell(['IMEI-1'])->assertCreated();

        $found = $this->lookup('IMEI-1')->assertOk()->json('data');
        $this->assertSame('2027-03-10', $found['warranty_expires_at']);
        $this->assertSame(365, $found['days_left']);
        $this->assertTrue($found['under_warranty']);
        $this->assertNull($found['came_back']);
        $this->assertFalse($found['on_shelf']);

        // Later the same day it is still 365 — not 364.6.
        $this->travelTo('2026-03-10 22:45:00');
        $this->assertSame(365, $this->lookup('IMEI-1')->json('data.days_left'));
    }

    public function test_a_unit_that_was_brought_back_is_not_under_anybodys_warranty(): void
    {
        $this->receive(['IMEI-1'])->assertOk();
        $sale = $this->sell(['IMEI-1'])->assertCreated()->json('data');
        $this->bringBack($sale, 1)->assertCreated();

        $found = $this->lookup('IMEI-1')->assertOk()->json('data');
        $this->assertFalse($found['under_warranty'], 'the shop\'s own stock is covered against the shop');
        $this->assertSame(0, $found['days_left']);
        $this->assertSame('returned', $found['came_back']['as']);
        $this->assertNotNull($found['came_back']['at']);
        $this->assertTrue($found['on_shelf']);

        // A unit taken in now is not recorded as an in-warranty claim.
        $claim = $this->req()->postJson('/api/v1/warranty/claims', ['serial' => 'IMEI-1', 'fault' => 'Screen flickers'])
            ->assertCreated()->json('data');
        $this->assertFalse($claim['was_under_warranty']);
    }

    public function test_one_of_two_came_back_and_the_desk_tells_them_apart(): void
    {
        $this->receive(['IMEI-1', 'IMEI-2'])->assertOk();
        $sale = $this->sell(['IMEI-1', 'IMEI-2'])->assertCreated()->json('data');
        $this->bringBack($sale, 1, ['IMEI-2'])->assertCreated();

        // The bill still stands — partly refunded — so it is the UNIT that says which is which.
        $back = $this->lookup('IMEI-2')->assertOk()->json('data');
        $this->assertSame('partially_refunded', $back['sale']['status']);
        $this->assertFalse($back['under_warranty']);
        $this->assertSame('returned', $back['came_back']['as']);

        $kept = $this->lookup('IMEI-1')->assertOk()->json('data');
        $this->assertTrue($kept['under_warranty'], 'the phone the customer kept lost its cover when the other one came back');
        $this->assertNull($kept['came_back']);
    }

    public function test_a_sale_that_was_voided_leaves_no_warranty_behind(): void
    {
        $this->receive(['IMEI-1'])->assertOk();
        $sale = $this->sell(['IMEI-1'])->assertCreated()->json('data');
        $this->req()->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item'])->assertOk();

        $found = $this->lookup('IMEI-1')->assertOk()->json('data');
        $this->assertFalse($found['under_warranty']);
        $this->assertSame('cancelled', $found['came_back']['as']);
        $this->assertNotNull($found['came_back']['at']);
        $this->assertTrue($found['on_shelf']);
    }

    public function test_sold_again_the_desk_answers_for_whoever_has_it_now(): void
    {
        $this->receive(['IMEI-1'])->assertOk();
        $first = $this->sell(['IMEI-1'])->assertCreated()->json('data');
        $this->bringBack($first, 1)->assertCreated();

        $this->travel(2)->days();
        $second = $this->sell(['IMEI-1'])->assertCreated()->json('data');

        $found = $this->lookup('IMEI-1')->assertOk()->json('data');
        $this->assertTrue($found['under_warranty']);
        $this->assertNull($found['came_back']);
        $this->assertFalse($found['on_shelf']);
        $this->assertSame($second['invoice_number'], $found['sale']['invoice_number']);
    }

    public function test_the_last_day_of_cover_is_counted_on_the_shops_calendar(): void
    {
        $this->shop('Asia/Karachi');
        // Half past one in the morning of the 11th in Karachi — still the 10th in UTC.
        $this->travelTo('2026-03-10 20:30:00');
        $this->receive(['IMEI-1'])->assertOk();
        $this->sell(['IMEI-1'])->assertCreated();

        $this->assertSame('2027-03-11', $this->lookup('IMEI-1')->json('data.warranty_expires_at'));

        // Two days before, at one in the morning in Karachi: the shop is on the
        // 10th and one day is left. The server, still on the 9th, would say two.
        $this->travelTo('2027-03-09 20:00:00');
        $this->assertSame(1, $this->lookup('IMEI-1')->json('data.days_left'));

        // The whole of the 11th, a year on, is covered where the shop stands…
        $this->travelTo('2027-03-11 18:00:00'); // 23:00 in Karachi
        $last = $this->lookup('IMEI-1')->json('data');
        $this->assertTrue($last['under_warranty']);
        $this->assertSame(0, $last['days_left']);

        // …and at ten past midnight it is over, though UTC still says the 11th.
        $this->travelTo('2027-03-11 19:10:00');
        $this->assertFalse($this->lookup('IMEI-1')->json('data.under_warranty'));
    }

    public function test_six_months_from_the_end_of_august_is_the_end_of_february(): void
    {
        $this->travelTo('2026-08-31 09:00:00');
        $this->receive(['IMEI-1'])->assertOk();
        $this->req()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 50000,
            'items' => [['product_id' => $this->phone->id, 'quantity' => 1, 'serials' => ['IMEI-1'], 'warranty_months' => 6]],
        ])->assertCreated();

        $this->assertSame('2027-02-28', $this->lookup('IMEI-1')->json('data.warranty_expires_at'));
    }

    // ── what the old returns desk left behind ────────────────────────

    /**
     * The state every refunded phone was left in before 2026-10-07: the
     * return went through with no number, so nothing was freed.
     */
    private function refundedTheOldWay(array $sale, int $qty): void
    {
        $this->bringBack($sale, $qty)->assertCreated();
        // Undo what today's return does, to stand where the old one left it.
        DB::table('sale_item_serials')->where('sale_id', $sale['id'])->update(['returned_at' => null]);
        DB::table('product_serials')->whereIn('serial', array_column(
            SaleItemSerial::withoutTenancy()->where('sale_id', $sale['id'])->get(['serial'])->all(), 'serial',
        ))->update(['status' => 'sold', 'sale_id' => $sale['id']]);
    }

    public function test_a_phone_refunded_before_the_fix_is_put_back_on_the_shelf_and_can_be_sold(): void
    {
        $this->receive(['OLD-1'])->assertOk();
        $sale = $this->sell(['OLD-1'])->assertCreated()->json('data');
        $this->refundedTheOldWay($sale, 1);

        // Stuck: on the shelf by count, sold by number — refused at the till, and
        // no return can free it, because the sale has been refunded.
        $this->assertSame('sold', $this->registry('OLD-1')->status);
        $this->sell(['OLD-1'])->assertStatus(422)->assertJsonPath('meta.error_code', 'SERIAL_ALREADY_SOLD');

        $this->assertSame(['units_back' => 1, 'back_on_shelf' => 1], UnitsBackOnTheShelf::repair());

        $this->assertSame('in_stock', $this->registry('OLD-1')->status);
        $this->assertNull($this->registry('OLD-1')->sale_id);
        $this->assertNotNull($this->sold('OLD-1')->returned_at);
        $this->sell(['OLD-1'])->assertCreated();

        // Run again: nothing more to do, and the unit just sold is NOT taken back.
        $this->assertSame(['units_back' => 0, 'back_on_shelf' => 0], UnitsBackOnTheShelf::repair());
        $this->assertSame('sold', $this->registry('OLD-1')->status);
    }

    public function test_both_of_two_came_back_the_old_way_and_both_are_mended(): void
    {
        $this->receive(['OLD-1', 'OLD-2'])->assertOk();
        $sale = $this->sell(['OLD-1', 'OLD-2'])->assertCreated()->json('data');
        // One return of one, then another of one — the line is back in full.
        $this->bringBack($sale, 1, ['OLD-1'])->assertCreated();
        $this->bringBack($sale, 1)->assertCreated();
        DB::table('sale_item_serials')->where('sale_id', $sale['id'])->update(['returned_at' => null]);
        DB::table('product_serials')->update(['status' => 'sold', 'sale_id' => $sale['id']]);

        UnitsBackOnTheShelf::repair();

        $this->assertSame('in_stock', $this->registry('OLD-1')->status);
        $this->assertSame('in_stock', $this->registry('OLD-2')->status);
        $this->assertNotNull($this->sold('OLD-1')->returned_at);
        $this->assertNotNull($this->sold('OLD-2')->returned_at);
    }

    public function test_one_of_two_came_back_the_old_way_and_nobody_can_say_which_so_neither_is_guessed(): void
    {
        $this->receive(['OLD-1', 'OLD-2'])->assertOk();
        $sale = $this->sell(['OLD-1', 'OLD-2'])->assertCreated()->json('data');
        $this->bringBack($sale, 1, ['OLD-1'])->assertCreated();
        DB::table('sale_item_serials')->where('sale_id', $sale['id'])->update(['returned_at' => null]);
        DB::table('product_serials')->update(['status' => 'sold', 'sale_id' => $sale['id']]);

        $this->assertSame(['units_back' => 0, 'back_on_shelf' => 0], UnitsBackOnTheShelf::repair());

        $this->assertSame('sold', $this->registry('OLD-1')->status);
        $this->assertSame('sold', $this->registry('OLD-2')->status);
    }

    public function test_a_unit_named_as_come_back_on_a_bill_that_still_stands_is_put_back(): void
    {
        $this->receive(['OLD-1', 'OLD-2'])->assertOk();
        $sale = $this->sell(['OLD-1', 'OLD-2'])->assertCreated()->json('data');
        $this->bringBack($sale, 1, ['OLD-1'])->assertCreated();
        // The unit is recorded as back, the bill still stands — and the shelf says sold.
        DB::table('product_serials')->where('serial', 'OLD-1')->update(['status' => 'sold', 'sale_id' => $sale['id']]);

        $this->assertSame(['units_back' => 0, 'back_on_shelf' => 1], UnitsBackOnTheShelf::repair());
        $this->assertSame('in_stock', $this->registry('OLD-1')->status);
        $this->assertSame('sold', $this->registry('OLD-2')->status);
    }

    public function test_a_unit_with_a_customer_is_never_put_back(): void
    {
        $this->receive(['OUT-1'])->assertOk();
        $this->sell(['OUT-1'])->assertCreated();

        $this->assertSame(['units_back' => 0, 'back_on_shelf' => 0], UnitsBackOnTheShelf::repair());
        $this->assertSame('sold', $this->registry('OUT-1')->status);
        $this->assertNull($this->sold('OUT-1')->returned_at);
    }

    public function test_a_voided_sale_left_sold_the_old_way_is_put_back(): void
    {
        $this->receive(['VOID-1'])->assertOk();
        $sale = $this->sell(['VOID-1'])->assertCreated()->json('data');
        $this->req()->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item'])->assertOk();
        DB::table('product_serials')->update(['status' => 'sold', 'sale_id' => $sale['id']]);

        UnitsBackOnTheShelf::repair();

        $this->assertSame('in_stock', $this->registry('VOID-1')->status);
    }

    public function test_one_shops_held_unit_does_not_hold_another_shops_number(): void
    {
        // This shop sold OLD-1 and was refunded the old way…
        $this->receive(['OLD-1'])->assertOk();
        $sale = $this->sell(['OLD-1'])->assertCreated()->json('data');
        $this->refundedTheOldWay($sale, 1);

        // …and another shop has a unit with the same number out with a customer.
        $mine = [$this->tenant, $this->owner, $this->phone];
        $this->shop('UTC');
        $this->receive(['OLD-1'])->assertOk();
        $this->sell(['OLD-1'])->assertCreated();
        [$this->tenant, $this->owner, $this->phone] = $mine;

        UnitsBackOnTheShelf::repair();

        $this->assertSame('in_stock', ProductSerial::withoutTenancy()->where('tenant_id', $this->tenant->id)->where('serial', 'OLD-1')->first()->status);
        $this->assertSame('sold', ProductSerial::withoutTenancy()->where('tenant_id', '!=', $this->tenant->id)->where('serial', 'OLD-1')->first()->status);
    }

    public function test_the_command_says_what_it_mended(): void
    {
        $this->receive(['OLD-1'])->assertOk();
        $sale = $this->sell(['OLD-1'])->assertCreated()->json('data');
        $this->refundedTheOldWay($sale, 1);

        $this->artisan('shopos:units-back-on-the-shelf')
            ->expectsOutput('1 unit(s) marked as come back; 1 back on the shelf.')
            ->assertSuccessful();
        $this->assertSame('in_stock', $this->registry('OLD-1')->status);
    }

    // ── the number on the box, scanned at the till ───────────────────

    public function test_scanning_a_units_own_number_finds_the_item_and_says_which_unit(): void
    {
        $this->receive(['356938035643801'])->assertOk();

        $this->req()->getJson('/api/v1/pos/lookup?code=356938035643801')
            ->assertOk()
            ->assertJsonPath('data.product.id', $this->phone->id)
            ->assertJsonPath('data.serial', '356938035643801');
    }

    public function test_a_model_barcode_is_still_a_model_and_carries_no_number(): void
    {
        Product::withoutTenancy()->whereKey($this->phone->id)->update(['barcode' => '8806095467924']);
        $this->receive(['356938035643801'])->assertOk();

        $this->req()->getJson('/api/v1/pos/lookup?code=8806095467924')
            ->assertOk()
            ->assertJsonPath('data.product.id', $this->phone->id)
            ->assertJsonPath('data.serial', null);
    }

    public function test_a_number_that_was_sold_is_said_to_be_sold_and_on_which_bill(): void
    {
        $this->receive(['356938035643801'])->assertOk();
        $sale = $this->sell(['356938035643801'])->assertCreated()->json('data');

        $refused = $this->req()->getJson('/api/v1/pos/lookup?code=356938035643801')
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'SERIAL_ALREADY_SOLD');
        $this->assertStringContainsString($sale['invoice_number'], $refused->json('message'));
    }

    public function test_a_code_that_is_nobodys_number_is_still_not_found(): void
    {
        $this->receive(['356938035643801'])->assertOk();

        $this->req()->getJson('/api/v1/pos/lookup?code=000000000000000')
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'POS_ITEM_NOT_FOUND');
    }

    public function test_a_number_two_items_share_is_not_guessed_at(): void
    {
        $other = $this->item('Powerbank 20k');
        $this->receive(['B-1001'])->assertOk();
        $this->receive(['B-1001'], product: $other)->assertOk();

        $this->req()->getJson('/api/v1/pos/lookup?code=B-1001')
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'SERIAL_AMBIGUOUS');
    }

    public function test_another_shops_number_is_nobodys_number_here(): void
    {
        $this->receive(['356938035643801'])->assertOk();

        $elsewhere = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'), 'timezone' => 'UTC',
        ]);
        $stranger = User::factory()->shopOwner($elsewhere)->create();
        $token = $stranger->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->getJson('/api/v1/pos/lookup?code=356938035643801')
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'POS_ITEM_NOT_FOUND');
    }
}
