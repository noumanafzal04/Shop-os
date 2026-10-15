<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE PAPER SAYS 1.235 KG, AND WHY THE OIL WAS CHEAPER.
 *
 * Tester pass 4 (B59), Rehmat Mart: rice weighed at 1.235 kg printed as
 * "1.235 × 320.50", and five bottles of oil at the bulk rate of 550 printed
 * with no word of why they cost less than the 560 on the shelf. The till says
 * both; the receipt now does too.
 */
class AGroceryReceiptSaysWhatItWeighedTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $mart = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($mart)->create();
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function item(array $with): string
    {
        return $this->as()->postJson('/api/v1/products', ['item_type' => 'physical_product', 'track_inventory' => false] + $with)
            ->assertCreated()->json('data.id');
    }

    /** The receipt for these lines, as one line of text. */
    private function paper(array $lines): string
    {
        $sale = $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => $lines, 'payment_method' => 'cash', 'amount_paid' => 10000,
        ])->assertCreated()->json('data');

        $html = $this->as()->get("/api/v1/sales/{$sale['id']}/invoice")->assertOk()->getContent();

        return preg_replace('/\s+/', ' ', strip_tags($html));
    }

    public function test_a_weighed_line_says_what_it_was_weighed_in(): void
    {
        $rice = $this->item(['name' => 'Basmati Rice', 'price' => 320.50, 'sold_by' => 'weight', 'unit' => 'kg']);
        $soap = $this->item(['name' => 'Bath Soap', 'price' => 120]);

        $text = $this->paper([['product_id' => $rice, 'quantity' => 1.235], ['product_id' => $soap, 'quantity' => 2]]);

        $this->assertStringContainsString('1.235 kg', $text, 'the rice does not say kg: '.$text);
        $this->assertStringNotContainsString('2 kg', $text, 'a counted item was given a weight');
    }

    public function test_a_bulk_rate_says_it_is_one(): void
    {
        $oil = $this->item(['name' => 'Cooking Oil 1L', 'price' => 560, 'price_tiers' => [['min_qty' => 5, 'price' => 550]]]);

        $five = $this->paper([['product_id' => $oil, 'quantity' => 5]]);
        $this->assertStringContainsString('Bulk price, 5 or more', $five, 'the bulk rate is not explained: '.$five);

        $four = $this->paper([['product_id' => $oil, 'quantity' => 4]]);
        $this->assertStringNotContainsString('Bulk price', $four, 'four bottles at the shelf price were called bulk');
    }
}
