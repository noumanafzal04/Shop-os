<?php

namespace Tests\Feature;

use App\Actions\Sale\CreateSaleAction;
use App\Models\City;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE QUOTE KNEW EACH RATE; THE INVOICE IT BECAME FORGOT THEM.
 *
 * A wholesale quotation for tea at 18% beside wheat flour at 0% is an
 * ordinary morning in Akbari Mandi. The document stores both rates, line by
 * line, snapshotted the day the price was given — which is the whole reason
 * a quotation is worth anything weeks later.
 *
 * Converting it produced an invoice with 7.08% stamped on BOTH lines. That
 * figure is the average: `CreateSaleAction` blends a trusted caller's single
 * settled `tax` across the basket and writes the blend onto every line.
 *
 * The blend is right for an ONLINE ORDER. An order quotes one tax figure for
 * the whole basket and genuinely has no per-line rate; leaving the catalog
 * rate on those lines would refund tax the shop never collected. That
 * reasoning does not reach a sale document, which has the rates.
 *
 * ── What the average actually costs ──────────────────────────────────────
 *
 *   the flour line   is refunded 7.08% tax on a ZERO-RATED staple
 *   the tea line     is refunded less than the 18% that was charged
 *   the tax report   grows a 7.08% band the shop is not registered for
 *   the invoice      prints a rate against flour that FBR does not recognise
 *
 * None of it is visible until somebody brings something back, and by then
 * the money has gone out of the drawer.
 *
 * Found by `loadtest:audit`, on exactly the four trades that have the
 * documents module and no others — which is what pointed at the conversion
 * rather than at the till.
 */
class TheQuoteKnewTheRateTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $tea;

    private Product $flour;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'wholesale',
            'features' => BusinessTypes::defaultFeatures('wholesale'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        // 18% — a taxed line.
        $this->tea = $this->product('Tea Leaves Sack', 4669, taxRate: 18);
        // 0% — a zero-rated staple, and the line the average hurts.
        $this->flour = $this->product('Wheat Flour Carton', 7204, taxRate: 0);
    }

    private function product(string $name, float $price, float $taxRate): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => $name, 'price' => $price, 'cost' => $price * 0.8,
            'tax_rate' => $taxRate,
            'track_inventory' => true, 'stock_quantity' => 50, 'is_active' => true,
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** A quotation for one sack of tea and one carton of flour. */
    private function mixedQuote(): array
    {
        return $this->as($this->owner)->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation',
            'customer_name' => 'Haji Sahib',
            'customer_phone' => '03001112233',
            'items' => [
                ['product_id' => $this->tea->id, 'quantity' => 1],
                ['product_id' => $this->flour->id, 'quantity' => 1],
            ],
        ])->assertCreated()->json('data');
    }

    private function convert(array $doc): Sale
    {
        $sale = $this->as($this->owner)->postJson("/api/v1/sale-documents/{$doc['id']}/convert", [
            'payment_method' => 'cash',
            'amount_paid' => $doc['total'],
        ])->assertCreated()->json('data.sale');

        return Sale::withoutTenancy()->with('items')->findOrFail($sale['id']);
    }

    public function test_the_quotation_itself_keeps_both_rates(): void
    {
        $doc = $this->mixedQuote();

        $rates = collect($doc['items'])->pluck('tax_rate')->map(fn ($r) => (float) $r)->sort()->values()->all();
        $this->assertSame([0.0, 18.0], $rates, 'The document is where the rates were snapshotted.');
    }

    public function test_the_invoice_carries_each_line_at_its_own_rate(): void
    {
        $sale = $this->convert($this->mixedQuote());

        $byName = $sale->items->keyBy('product_name');

        $this->assertSame(
            18.0,
            round((float) $byName['Tea Leaves Sack']->tax_rate, 2),
            'The tea was quoted at 18% and the invoice has to say so.',
        );
        $this->assertSame(
            0.0,
            round((float) $byName['Wheat Flour Carton']->tax_rate, 2),
            'Flour is zero-rated. An average rate puts tax on a staple that carries none.',
        );
    }

    /**
     * THE BILL STILL ADDS UP.
     *
     * Carrying the rates must not change what the customer pays: the
     * conversion is a promise being kept, and the tax on the invoice is the
     * tax that was quoted.
     */
    public function test_the_invoice_charges_exactly_what_was_quoted(): void
    {
        $doc = $this->mixedQuote();
        $sale = $this->convert($doc);

        $this->assertSame(round((float) $doc['tax'], 2), round((float) $sale->tax, 2));
        $this->assertSame(round((float) $doc['total'], 2), round((float) $sale->total, 2));
    }

    /**
     * AND THE LINES RECONCILE TO IT.
     *
     * The audit's check, written out as a test: the bill's tax is the sum of
     * its own lines' tax, each at its own rate. With the average stamped on
     * both lines this is out by 19 paisa — small, and wrong on both lines in
     * opposite directions, which is how it survived.
     */
    public function test_the_lines_add_up_to_the_bill(): void
    {
        $sale = $this->convert($this->mixedQuote());

        $built = 0.0;
        foreach ($sale->items as $line) {
            $built += (float) $line->line_total * (float) $line->tax_rate / 100;
        }

        $this->assertEqualsWithDelta((float) $sale->tax, round($built, 2), 0.02);
    }

    /**
     * AN ORDER IS STILL BLENDED, AND MUST BE.
     *
     * The fix is narrow on purpose. An online order settles ONE tax figure
     * for the basket — frequently zero — and has no per-line rate to send.
     * Stamping the catalog's 18% on those lines would refund tax the shop
     * never took, which is the fault the blend was introduced to stop.
     */
    public function test_a_basket_with_no_quoted_rates_is_still_blended(): void
    {
        app(TenantContext::class)->set($this->shop);
        auth()->setUser($this->owner);

        $sale = app(CreateSaleAction::class)->execute([
            'channel' => 'online',
            'items' => [
                ['product_id' => $this->tea->id, 'quantity' => 1, 'unit_price' => 4669, 'line_total' => 4669],
                ['product_id' => $this->flour->id, 'quantity' => 1, 'unit_price' => 7204, 'line_total' => 7204],
            ],
            // The order quoted no tax at all — the customer was shown 11,873.
            'tax' => 0.0,
            'trusted_prices' => true,
            'payment_method' => 'cash',
            'amount_paid' => 11873,
            'created_by' => $this->owner->id,
        ]);

        foreach ($sale->items as $line) {
            $this->assertSame(
                0.0,
                round((float) $line->tax_rate, 2),
                'An order that charged no tax must not leave a catalog rate on its lines.',
            );
        }
    }
}
