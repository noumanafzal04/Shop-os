<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\SaleReturn;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A SALE PAID TWO WAYS, OR PUT ON KHATA, CAN BE TAKEN BACK.
 *
 * Tester pass 1 (B03, B04): the returns desk sent the sale's own payment
 * method as the refund method — "split" for cash + card, "credit" for khata —
 * and the server takes only something a counter hands over. Both refused 422,
 * the screen said "The given data was invalid", and there was no other way.
 * And for khata the sheet said 4,990 "goes back to the customer" for a sale
 * nobody had paid: what is still owed comes off the account instead.
 */
class ASplitOrKhataSaleCanComeBackTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private string $shirt;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($shop)->create();
        $this->shirt = $this->as()->postJson('/api/v1/products', [
            'name' => 'Cotton Shirt', 'item_type' => 'physical_product', 'price' => 1800, 'track_inventory' => false,
        ])->assertCreated()->json('data.id');
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @return array{worth: array, done: TestResponse} */
    private function oneBack(array $sale): array
    {
        $items = [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]];

        return [
            'worth' => $this->as()->postJson("/api/v1/sales/{$sale['id']}/returns/worth", ['items' => $items])->assertOk()->json('data'),
            'done' => $this->as()->postJson("/api/v1/sales/{$sale['id']}/returns", ['items' => $items]),
        ];
    }

    public function test_a_sale_paid_in_cash_and_card_comes_back_in_cash(): void
    {
        $sale = $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $this->shirt, 'quantity' => 2]],
            'payments' => [['method' => 'cash', 'amount' => 2000], ['method' => 'card', 'amount' => 1600]],
        ])->assertCreated()->json('data');
        $this->assertSame('split', $sale['payment_method']);

        $back = $this->oneBack($sale);

        $this->assertSame('cash', $back['worth']['back_by']);
        $this->assertEquals(1800, $back['worth']['handed_back']);
        $return = $back['done']->assertCreated()->json('data');
        $this->assertSame('cash', $return['refund_method']);
        $this->assertEquals(1800, $return['refund_total']);
    }

    public function test_a_khata_sale_comes_off_the_khata_and_nothing_is_handed_over(): void
    {
        $sale = $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $this->shirt, 'quantity' => 1]],
            'payment_method' => 'credit', 'amount_paid' => 1800, 'customer_phone' => '03001234567', 'customer_name' => 'Ayesha',
        ])->assertCreated()->json('data');
        $ayesha = Customer::withoutTenancy()->where('phone', '03001234567')->firstOrFail();
        $this->assertEquals(1800, $ayesha->credit_balance);

        $back = $this->oneBack($sale);

        $this->assertEquals(1800, $back['worth']['off_khata'], 'the sheet did not say the khata goes down');
        $this->assertEquals(0, $back['worth']['handed_back'], 'the sheet says money goes back for a sale nobody paid');
        $back['done']->assertCreated();
        $this->assertEquals(0, $ayesha->fresh()->credit_balance, 'the khata did not come down');
        $return = SaleReturn::withoutTenancy()->sole();
        $this->assertEquals(1800, $return->refund_credit);
        $this->assertSame('cash', $return->refund_method);
    }

    public function test_a_sale_paid_one_way_still_goes_back_that_way(): void
    {
        $sale = $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $this->shirt, 'quantity' => 1]],
            'payment_method' => 'card', 'amount_paid' => 1800,
        ])->assertCreated()->json('data');

        $this->assertSame('card', $this->oneBack($sale)['done']->assertCreated()->json('data.refund_method'));
    }
}
