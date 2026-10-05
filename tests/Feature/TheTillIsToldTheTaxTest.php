<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\TaxGroup;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * THE TILL IS TOLD WHAT THE SERVER WILL CHARGE.
 *
 * ── The report this is the fix for ───────────────────────────────────
 *
 *     Amount due          Rs 12,610
 *     Sale failed         Amount paid (12,610.00) is less than the total
 *                         (14,023.94).
 *
 * A product on a tax group is taxed at the GROUP's rate. The sale has always
 * done that. The product payload carried `tax_group_id` and nothing that
 * turned it into a percentage, so the counter screen taxed those lines at the
 * shop's default — zero, usually — showed an amount due, and was refused for
 * being short by exactly the tax.
 *
 * On the database this was found on, 17,140 products are on a tax group and
 * 124 carry a rate of their own. It was not an edge case.
 *
 * ── Why 1,100 green tests said nothing ───────────────────────────────
 *
 * `TaxTest` covers every branch of the tax engine — and tenders
 * `amount_paid => 1000000` on every sale. A million rupees covers any bill,
 * so no case could ever fail for being short, which is the ONLY way this
 * defect shows itself. The branch was covered; its consequence was not.
 *
 * So every sale in this file is paid with the figure a CLIENT would work out
 * from what it was told, to the paisa. That is the instrument.
 */
class TheTillIsToldTheTaxTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'), 'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function group(string $name, float $rate): TaxGroup
    {
        return TaxGroup::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => $name, 'rate' => $rate, 'is_active' => true,
        ]);
    }

    private function product(array $over): Product
    {
        return Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Item', 'price' => 100, 'stock_quantity' => 1000, 'track_inventory' => true,
        ], $over));
    }

    /**
     * WHAT A CLIENT WORKS OUT, from the payload and nothing else.
     *
     * Deliberately not a call into the server's own pricing — that would be
     * the server agreeing with itself. This is the three-step rule a till
     * applies to each product it was handed: the group's rate, else the
     * product's own, else the shop default.
     *
     * @param  array<int, array{0: array<string, mixed>, 1: float}>  $lines  [payload, qty]
     */
    private function clientTotal(array $lines, float $shopDefault = 0.0): float
    {
        $total = 0.0;
        foreach ($lines as [$payload, $qty]) {
            $rate = $payload['tax_group_rate'] ?? $payload['tax_rate'] ?? $shopDefault;
            $net = round((float) $payload['price'] * $qty, 2);
            $total += $net + round($net * (float) $rate / 100, 2);
        }

        return round($total, 2);
    }

    /** The product exactly as the products list hands it to a till. */
    private function asListed(Product $product): array
    {
        $rows = $this->asOwner()->getJson('/api/v1/products?per_page=100')->assertOk()->json('data');

        foreach ($rows as $row) {
            if ($row['id'] === $product->id) {
                return $row;
            }
        }

        $this->fail('the product was not in the list a till reads');
    }

    // ── The payload says what will be charged ────────────────────────

    public function test_a_product_on_a_tax_group_carries_the_groups_rate(): void
    {
        $gst = $this->group('GST 18%', 18);
        $p = $this->product(['tax_group_id' => $gst->id, 'tax_rate' => null]);

        $row = $this->asListed($p);

        // The exact shape that produced the bug: no rate of its own, and a
        // group id a cashier's till had no way to translate.
        $this->assertNull($row['tax_rate']);
        $this->assertSame($gst->id, $row['tax_group_id']);
        $this->assertEquals(18.0, $row['tax_group_rate']);
    }

    public function test_a_product_on_no_group_says_null_rather_than_zero(): void
    {
        $p = $this->product(['tax_rate' => 5]);

        $row = $this->asListed($p);

        // Null, NOT 0. Zero is a rate — it means exempt, and a till that read
        // it would stop charging the product's own 5%. Null means "no group
        // has an opinion; look at the next rule".
        $this->assertArrayHasKey('tax_group_rate', $row);
        $this->assertNull($row['tax_group_rate']);
    }

    public function test_the_group_beats_the_products_own_rate_in_the_payload_too(): void
    {
        // A product can carry both — it was on 5% and was then moved onto a
        // group. The sale charges the group. The payload must say the same,
        // or the till is back to being short by the difference.
        $gst = $this->group('Standard 18%', 18);
        $p = $this->product(['tax_group_id' => $gst->id, 'tax_rate' => 5]);

        $row = $this->asListed($p);

        $this->assertEquals(18.0, $row['tax_group_rate']);
        $this->assertEquals(18.0, $p->fresh()->effectiveTaxRate(0));
    }

    public function test_the_barcode_lookup_carries_it_as_well(): void
    {
        // The other door a product reaches the till by. A rule that covers
        // the grid and not the scanner is half a rule, and the missed half is
        // the one a busy counter uses.
        $gst = $this->group('GST 17%', 17);
        $p = $this->product(['tax_group_id' => $gst->id, 'sku' => 'SCAN-ME-1']);

        $hit = $this->asOwner()->getJson('/api/v1/pos/lookup?code=SCAN-ME-1')->assertOk()->json('data.product');

        $this->assertEquals(17.0, $hit['tax_group_rate']);
    }

    // ── And a sale paid with that figure goes through ─────────────────

    public function test_a_tender_worked_out_from_the_payload_is_accepted(): void
    {
        /**
         * THE REPORTED CART, in miniature: lines on two different groups and
         * one on neither, with a shop default of zero — so a till that
         * ignored the groups would be short by all of the tax.
         */
        $standard = $this->group('Standard 18%', 18);
        $reduced = $this->group('Reduced 10%', 10);

        $a = $this->product(['name' => 'A', 'price' => 4200, 'tax_group_id' => $standard->id]);
        $b = $this->product(['name' => 'B', 'price' => 6310, 'tax_group_id' => $reduced->id]);
        $c = $this->product(['name' => 'C', 'price' => 2100]);

        $tender = $this->clientTotal([[$this->asListed($a), 1], [$this->asListed($b), 1], [$this->asListed($c), 1]]);

        // 4200 + 756, 6310 + 631, 2100 + 0.
        $this->assertSame(13997.0, $tender);

        $sale = $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'card', 'amount_paid' => $tender,
            'items' => [
                ['product_id' => $a->id, 'quantity' => 1],
                ['product_id' => $b->id, 'quantity' => 1],
                ['product_id' => $c->id, 'quantity' => 1],
            ],
        ])->assertCreated()->json('data');

        // Exact, not "at least": a card tender has no change to absorb a
        // difference, so one paisa either way is a refusal or a wrong charge.
        $this->assertEquals($tender, (float) $sale['total']);
        $this->assertEquals(1387.0, (float) $sale['tax']);
    }

    public function test_a_tender_that_ignores_the_group_is_refused_which_is_the_bug(): void
    {
        /**
         * The denominator. The case above passes only if the payload carries
         * the rate — and this is what a till computed WITHOUT it: the same
         * cart, taxed at the shop default. It must be refused, or the case
         * above is not proving anything about tax at all.
         */
        $standard = $this->group('Standard 18%', 18);
        $a = $this->product(['price' => 1000, 'tax_group_id' => $standard->id]);

        $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'card', 'amount_paid' => 1000,
            'items' => [['product_id' => $a->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PAYMENT_INSUFFICIENT');
    }

    // ── A refusal a till can recover from ────────────────────────────

    public function test_a_short_tender_is_told_the_figure_that_will_be_accepted(): void
    {
        $standard = $this->group('Standard 18%', 18);
        $a = $this->product(['price' => 1000, 'tax_group_id' => $standard->id]);
        $items = [['product_id' => $a->id, 'quantity' => 1]];

        $refusal = $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'card', 'amount_paid' => 1000, 'items' => $items,
        ])->assertStatus(422);

        // As DATA. The sentence carries the same number inside
        // `number_format`, and a client that parses "14,023.94" out of prose
        // is one thousands separator away from a wrong charge.
        $refusal->assertJsonPath('meta.error_code', 'PAYMENT_INSUFFICIENT');
        $this->assertEquals(1180.0, $refusal->json('meta.amount_due'));
        $this->assertEquals(1000.0, $refusal->json('meta.amount_paid'));
        $this->assertEquals(180.0, $refusal->json('meta.tax'));

        // And the whole point: nothing was sold by the refused attempt, and
        // paying exactly the figure it named completes the sale. Without this
        // half the test would pass on a server that returned any number.
        $this->assertSame(0, DB::table('sales')->where('tenant_id', $this->tenant->id)->count());

        $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'card',
            'amount_paid' => $refusal->json('meta.amount_due'), 'items' => $items,
        ])->assertCreated()->assertJsonPath('data.total', '1180.00');
    }

    // ── It is cheap, and it does not go stale ────────────────────────

    public function test_a_page_of_products_asks_once_per_group_not_once_per_row(): void
    {
        $gst = $this->group('GST 18%', 18);
        for ($i = 0; $i < 30; $i++) {
            $this->product(['name' => "P{$i}", 'tax_group_id' => $gst->id]);
        }

        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        DB::enableQueryLog();
        $rows = $this->withToken($token)->getJson('/api/v1/products?per_page=100')->assertOk()->json('data');
        $groupReads = collect(DB::getQueryLog())->filter(fn ($q) => str_contains($q['query'], 'tax_groups'))->count();
        DB::disableQueryLog();

        $this->assertCount(30, $rows);
        // Thirty products, one group: one read. An accessor that lazy-loaded
        // the relation would make this thirty, and a shop with a thousand
        // items on a page-of-a-hundred grid would feel it at the counter.
        $this->assertSame(1, $groupReads);
    }

    public function test_a_re_rated_group_is_re_read_rather_than_remembered(): void
    {
        $gst = $this->group('GST', 17);
        $p = $this->product(['price' => 1000, 'tax_group_id' => $gst->id]);

        // Read once, so the rate is in memory for this request.
        $this->assertEquals(17.0, $p->fresh()->effectiveTaxRate(0));

        // The shop changes the rate.
        $gst->update(['rate' => 18]);

        // The money path reads through the same memo. Charged at 17 here
        // would be a sale short of what the group now says, with the till and
        // the server both confidently wrong.
        $this->assertEquals(18.0, $p->fresh()->effectiveTaxRate(0));

        $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'card', 'amount_paid' => 1180,
            'items' => [['product_id' => $p->id, 'quantity' => 1]],
        ])->assertCreated()->assertJsonPath('data.tax', '180.00');
    }
}
