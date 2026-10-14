<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A CUSTOMER MAY SWAP FOR SOMETHING CHEAPER, AND GETS THE REST BACK.
 *
 * Zari, 2026-10-13: a 2,950 kurta brought back and swapped for a 1,850 kids'
 * suit was refused — "No cash was handed over, so there is no change to give".
 * The exchange pays the new bill with the returned goods and gives the rest
 * back as change; a rule written for card overpayments counted the goods as
 * no cash at all. Every downgrade was impossible.
 */
class ExchangeForSomethingCheaperTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private User $manager;

    private string $kurta;

    private string $suit;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($shop)->create();
        $this->manager = User::factory()->create(['tenant_id' => $shop->id, 'role' => 'staff', 'permissions' => ['sales.manage', 'sales.refund']]);
        $this->kurta = $this->item('Cotton Kurta', 2950);
        $this->suit = $this->item('Kids Suit', 1850);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function item(string $name, float $price): string
    {
        return $this->as($this->owner)->postJson('/api/v1/products', [
            'name' => $name, 'item_type' => 'physical_product', 'price' => $price, 'track_inventory' => true, 'stock_quantity' => 5,
        ])->assertCreated()->json('data.id');
    }

    private function stock(string $id): float
    {
        return (float) Product::withoutTenancy()->whereKey($id)->value('stock_quantity');
    }

    private function exchangeIt(array $payments = []): TestResponse
    {
        $sale = $this->as($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $this->kurta, 'quantity' => 1]], 'payment_method' => 'cash', 'amount_paid' => 2950,
        ])->assertCreated()->json('data');

        return $this->as($this->manager)->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'items' => [['product_id' => $this->suit, 'quantity' => 1]],
            'payments' => $payments, 'channel' => 'walk_in',
        ]);
    }

    public function test_the_cheaper_swap_goes_through_and_the_rest_comes_back_as_change(): void
    {
        $this->as($this->manager)->postJson('/api/v1/pos/session/open', ['opening_float' => 3000])->assertSuccessful();

        $done = $this->exchangeIt()->assertCreated()->json('data');

        $this->assertSame(1850.0, (float) $done['sale']['total']);
        $this->assertSame(1100.0, (float) $done['sale']['change_due'], 'the customer was not given the difference');
        $this->assertSame(-1100.0, (float) $done['difference']);
        $this->assertSame(5.0, $this->stock($this->kurta), 'the kurta did not go back on the shelf');
        $this->assertSame(4.0, $this->stock($this->suit));

        // Out of HER drawer, the one that handed the notes over.
        $drawer = $this->as($this->manager)->getJson('/api/v1/pos/session/report')->assertOk()->json('data.drawer');
        $this->assertSame(1900.0, (float) $drawer['expected_cash'], 'the 1,100 handed back did not come off the drawer it left');
    }

    public function test_an_even_swap_moves_no_money(): void
    {
        $this->suit = $this->item('Another Kurta', 2950);

        $done = $this->exchangeIt()->assertCreated()->json('data');

        $this->assertSame(0.0, (float) $done['sale']['change_due']);
    }

    public function test_a_card_overpayment_at_the_counter_is_still_refused(): void
    {
        // The rule the exchange is excused from still stands for everyone else.
        $this->as($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $this->suit, 'quantity' => 1]], 'payment_method' => 'card', 'amount_paid' => 5000,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'CHANGE_WITHOUT_CASH');
    }

    public function test_a_sale_cannot_claim_an_exchange_credit_of_its_own(): void
    {
        // The field is set by the exchange on the server; sent by a till it is dropped.
        $this->as($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $this->suit, 'quantity' => 1]], 'payment_method' => 'card', 'amount_paid' => 5000,
            'exchange_credit' => 5000,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'CHANGE_WITHOUT_CASH');
    }
}
