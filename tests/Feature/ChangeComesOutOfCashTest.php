<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CashSession;
use App\Models\City;
use App\Models\Product;
use App\Models\Register;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\DrawerMath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * CHANGE COMES OUT OF CASH, BECAUSE THERE IS NOWHERE ELSE FOR IT TO COME FROM.
 *
 * `change_due` was `amount_paid - due`, whatever the money arrived as. So a
 * sale tendered on a CARD for more than the bill recorded change — real
 * rupees the cashier is told to hand back against a card that was charged the
 * exact amount.
 *
 * ── THE PRODUCT ALREADY BELIEVED THIS ───────────────────────────────
 *
 * The khata path has carried the rule, and the reasoning, since it was
 * written:
 *
 *   "A khata sale must never produce cash change… a fat-fingered credit
 *    amount turns the POS into a cash dispenser."
 *
 * Every word of that is true of a card. The rule was right and it was applied
 * to one tender type.
 *
 * ── AND IT IS NOT ONLY THE RECEIPT ──────────────────────────────────
 *
 * `DrawerMath` subtracts `change_due` across every sale in the shift from the
 * cash it took. Change recorded against a sale that tendered no cash comes
 * straight off the drawer's expectation, so the cashier is asked to explain a
 * shortage that never happened. Found by a load-test fixture that paid for
 * card sales with a 1,000,000 note: average `cash_sales` of MINUS 2.78
 * million across ninety-one shifts.
 */
class ChangeComesOutOfCashTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $product;

    private Register $lane;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice 5kg', 'price' => 1000, 'cost' => 800,
            'stock_quantity' => 500, 'track_inventory' => true,
        ]);

        $main = Branch::withoutTenancy()
            ->where('tenant_id', $this->shop->id)->where('is_default', true)->firstOrFail();
        $this->lane = Register::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'branch_id' => $main->id, 'name' => 'Lane 1', 'is_active' => true,
        ]);
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function openTill(): string
    {
        return $this->as()->postJson('/api/v1/pos/session/open', [
            'opening_float' => 5000, 'register_id' => $this->lane->id,
        ])->assertCreated()->json('data.id');
    }

    /** @param array<string, mixed> $extra */
    private function ring(array $extra)
    {
        return $this->as()->postJson('/api/v1/sales', array_merge([
            'channel' => 'walk_in',
            'items' => [['product_id' => $this->product->id, 'quantity' => 2]],
        ], $extra));
    }

    public function test_a_card_cannot_hand_back_cash(): void
    {
        $this->openTill();

        // A 2,000 bill, "paid" 10,000 on a card. There is no 8,000 to give.
        $this->ring(['payment_method' => 'card', 'amount_paid' => 10000])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'CHANGE_WITHOUT_CASH');
    }

    /** THE DENOMINATOR — the card still works, for the amount of the bill. */
    public function test_a_card_for_exactly_the_bill_goes_through(): void
    {
        $this->openTill();

        $sale = $this->ring(['payment_method' => 'card', 'amount_paid' => 2000])
            ->assertCreated()->json('data');

        $this->assertSame(0.0, round((float) $sale['change_due'], 2));
    }

    public function test_cash_still_gives_change(): void
    {
        $this->openTill();

        $sale = $this->ring(['payment_method' => 'cash', 'amount_paid' => 5000])
            ->assertCreated()->json('data');

        $this->assertSame(3000.0, round((float) $sale['change_due'], 2));
    }

    /**
     * A SPLIT TENDER GIVES CHANGE OUT OF ITS CASH HALF, AND NO FURTHER.
     *
     * 500 cash and 2,000 on the card against a 2,000 bill: 500 of change is
     * payable out of the 500 that came in.
     */
    public function test_change_on_a_split_comes_out_of_the_cash_part(): void
    {
        $this->openTill();

        $sale = $this->ring([
            'payment_method' => 'cash',
            'amount_paid' => 2500,
            'payments' => [
                ['method' => 'cash', 'amount' => 500],
                ['method' => 'card', 'amount' => 2000],
            ],
        ])->assertCreated()->json('data');

        $this->assertSame(500.0, round((float) $sale['change_due'], 2));
    }

    /** …and not a rupee more than the cash that came in. */
    public function test_a_split_cannot_hand_back_more_cash_than_it_took(): void
    {
        $this->openTill();

        $this->ring([
            'payment_method' => 'cash',
            'amount_paid' => 5000,
            'payments' => [
                ['method' => 'cash', 'amount' => 200],
                ['method' => 'card', 'amount' => 4800],
            ],
        ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'CHANGE_WITHOUT_CASH');
    }

    /**
     * THE CONSEQUENCE, which is the reason this matters at all: the drawer.
     *
     * One card sale and one cash sale. The drawer expects the float plus the
     * cash sale, and nothing else — the card sale neither adds to it nor, as
     * it used to, takes its "change" out of it.
     */
    public function test_a_card_sale_leaves_the_drawer_alone(): void
    {
        $sessionId = $this->openTill();

        $this->ring(['payment_method' => 'card', 'amount_paid' => 2000])->assertCreated();
        $this->ring(['payment_method' => 'cash', 'amount_paid' => 5000])->assertCreated();

        $drawer = DrawerMath::for(CashSession::withoutTenancy()->findOrFail($sessionId));

        $this->assertSame(2000.0, round((float) $drawer['cash_sales'], 2));
        $this->assertSame(7000.0, round((float) $drawer['expected_cash'], 2));
    }
}
