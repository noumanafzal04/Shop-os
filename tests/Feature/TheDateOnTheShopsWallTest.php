<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A DATE SOMEBODY CAN READ OFF A BOX IS THE DATE ON THE SHOP'S WALL.
 *
 * An expiry date, a quotation's "valid until", the day a bill falls due: each
 * is a date on a calendar, and each was being compared with the SERVER'S
 * today — which in Karachi stays on yesterday until five in the morning.
 *
 *   a strip that expired on the 6th was sold at four in the morning on the 7th
 *   a quotation valid until the 6th was not "lapsed" until five
 *   rent due on the 7th was not due at one o'clock on the 7th
 *
 * Five hours a night, every night, and only the shops that are open then —
 * which for a 24-hour chemist is the shift with one person on it.
 *
 * Not ShopDay's business day: that is for MOMENTS (a sale belongs to the
 * evening it was rung in). A date printed on a box does not move with the
 * hour a shop cashes up. Each test below is run at one in the morning on the
 * 7th, when the wall says the 7th and the server still says the 6th.
 */
final class TheDateOnTheShopsWallTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
    }

    private function open(string $type): void
    {
        $this->shop = Tenant::factory()->create([
            'business_type' => $type,
            // Quotations are a module a mart does not start with.
            'features' => ['documents' => true] + BusinessTypes::defaultFeatures($type),
            'setup_completed' => true,
            'timezone' => 'Asia/Karachi',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    public function test_a_strip_that_expired_yesterday_is_not_sold_in_the_small_hours(): void
    {
        $this->open('pharmacy');
        $this->at('2026-10-06 12:00');

        $amoxil = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Amoxil', 'barcode' => '8964000012345', 'price' => 10,
            'stock_quantity' => 0, 'track_inventory' => true,
        ]);
        foreach ([['GOOD', '2026-12-01'], ['LAST-DAY', '2026-10-06']] as [$number, $expiry]) {
            $this->as()->postJson("/api/v1/inventory/products/{$amoxil->id}/batches", [
                'batch_number' => $number, 'expiry_date' => $expiry, 'quantity' => 10,
            ])->assertCreated();
        }

        // Eleven at night on the 6th: the strip is good THROUGH its date, and
        // first-to-expire goes first.
        $this->at('2026-10-06 23:00');
        $this->sell($amoxil, 2)->assertCreated();
        $this->assertEquals(8, $this->lot('LAST-DAY')->quantity);
        $this->assertEquals(10, $this->lot('GOOD')->quantity);

        // One in the morning on the 7th. It expired yesterday.
        $this->at('2026-10-07 01:00');

        // Scanned at the till, the lot to watch is GOOD — not one already
        // dead — and its days are counted from the 7th: 24 + 30 + 1.
        $this->as()->getJson('/api/v1/pos/lookup?code=8964000012345')->assertOk()
            ->assertJsonPath('data.near_expiry.batch_number', 'GOOD')
            ->assertJsonPath('data.near_expiry.days', 55);

        // Eighteen on the shelf, ten of them sellable.
        $this->sell($amoxil, 11)->assertStatus(422)->assertJsonPath('meta.error_code', 'STOCK_EXPIRED');

        // And what IS sold comes from the live lot, not the dead one.
        $this->sell($amoxil, 4)->assertCreated();
        $this->assertEquals(8, $this->lot('LAST-DAY')->quantity, 'An expired lot was dispensed.');
        $this->assertEquals(6, $this->lot('GOOD')->quantity);
    }

    public function test_a_quotation_valid_until_yesterday_has_lapsed_by_one_in_the_morning(): void
    {
        $this->open('mart');
        $this->at('2026-10-06 12:00');

        $item = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice 5kg', 'price' => 1500, 'stock_quantity' => 50, 'track_inventory' => true,
        ]);
        $quote = $this->as()->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation',
            'customer_name' => 'Asif',
            'items' => [['product_id' => $item->id, 'quantity' => 2]],
            'expires_at' => '2026-10-06',
        ])->assertCreated()->json('data');

        // Still good on its last day, to the last hour of it.
        $this->at('2026-10-06 23:30');
        $this->assertSame(0, $this->as()->getJson('/api/v1/sale-documents/summary')->json('data.overdue'));
        $this->assertCount(0, $this->as()->getJson('/api/v1/sale-documents?status=lapsed')->json('data'));
        $this->assertFalse((bool) $this->as()->getJson("/api/v1/sale-documents/{$quote['id']}")->json('data.has_lapsed'));

        $this->at('2026-10-07 01:00');
        $this->assertSame(1, $this->as()->getJson('/api/v1/sale-documents/summary')->json('data.overdue'));
        $this->assertCount(1, $this->as()->getJson('/api/v1/sale-documents?status=lapsed')->json('data'));
        // The list and the document's own page give one answer.
        $this->assertTrue((bool) $this->as()->getJson("/api/v1/sale-documents/{$quote['id']}")->json('data.has_lapsed'));

        // And a new one cannot be written already expired — by the wall's date.
        $this->as()->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'customer_name' => 'Asif',
            'items' => [['product_id' => $item->id, 'quantity' => 1]],
            'expires_at' => '2026-10-06',
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['expires_at']]);
        $this->as()->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'customer_name' => 'Asif',
            'items' => [['product_id' => $item->id, 'quantity' => 1]],
            'expires_at' => '2026-10-07',
        ])->assertCreated();
    }

    public function test_rent_due_today_is_due_at_one_in_the_morning_and_can_be_posted(): void
    {
        $this->open('mart');
        $this->at('2026-10-06 12:00');

        $category = $this->as()->postJson('/api/v1/expense-categories', ['name' => 'Rent'])->assertCreated()->json('data.id');
        $rent = $this->as()->postJson('/api/v1/expenses/recurring', [
            'expense_category_id' => $category,
            'description' => 'Shop rent',
            'amount' => 45000,
            'payment_method' => 'bank_transfer',
            'frequency' => 'monthly',
            'next_due_on' => '2026-10-07',
        ])->assertCreated()->json('data');

        // The evening before: not yet, on the list or at the button.
        $this->at('2026-10-06 23:30');
        $this->assertCount(0, $this->as()->getJson('/api/v1/expenses/recurring?due=1')->json('data'));
        $this->as()->postJson("/api/v1/expenses/recurring/{$rent['id']}/post", [])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'RECURRING_NOT_DUE');

        // One in the morning on the day itself.
        $this->at('2026-10-07 01:00');
        $due = $this->as()->getJson('/api/v1/expenses/recurring?due=1')->json('data');
        $this->assertCount(1, $due);
        $this->assertTrue((bool) $due[0]['is_due'], 'On the due list, and its own flag says it is not due.');

        // The list offered it; the button must not then refuse it.
        $posted = $this->as()->postJson("/api/v1/expenses/recurring/{$rent['id']}/post", [])->assertCreated();
        $this->assertSame('2026-10-07', substr((string) $posted->json('data.expense_date'), 0, 10));
        $this->assertSame('2026-11-07', $posted->json('meta.next_due_on'));
        // Posted today — by the wall, where "today" is the 7th.
        $this->assertSame(
            '2026-10-07',
            substr((string) $this->as()->getJson('/api/v1/expenses/recurring')->json('data.0.last_posted_on'), 0, 10),
        );
    }

    // ── Plumbing ────────────────────────────────────────────────────

    private function at(string $wall): void
    {
        $this->travelTo(Carbon::parse($wall, 'Asia/Karachi'));
    }

    private function sell(Product $product, int $qty): TestResponse
    {
        return $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => $qty * 10,
            'items' => [['product_id' => $product->id, 'quantity' => $qty]],
        ]);
    }

    private function lot(string $number): ProductBatch
    {
        return ProductBatch::withoutTenancy()->where('batch_number', $number)->firstOrFail();
    }

    private function as(): static
    {
        $this->defaultHeaders = [];
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
