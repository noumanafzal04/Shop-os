<?php

namespace Tests\Feature;

use App\Models\SaleReturn;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BooksDrawer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * CASH HANDED BACK GOES THROUGH THE REFUNDER'S OWN DRAWER — AND THEY ARE TOLD
 * WHEN THERE IS NONE.
 *
 * Zari Clothing, 2026-10-13: the manager refunded two sales in cash from the
 * returns desk with no shift of her own. The refund was saved, the cashbook
 * showed 7,440 going out — and no drawer heard about it. The cashier whose
 * till the notes came out of would close 7,440 short.
 *
 * The rule is the expenses' rule (their own drawer, or none — never a
 * stranger's). What was missing is the warning: the returns desk now hears
 * BEFORE the press whose drawer the cash lands in, and the answer says so.
 */
class CashHandedBackIsCountedSomewhereTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $manager;

    private array $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->manager = User::factory()->create([
            'tenant_id' => $this->shop->id, 'role' => 'staff', 'permissions' => ['sales.manage', 'sales.refund'],
        ]);
        $this->item = $this->as($this->owner)->postJson('/api/v1/products', [
            'name' => 'Silk Scarf', 'item_type' => 'physical_product', 'price' => 1450, 'track_inventory' => false,
        ])->assertCreated()->json('data');
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** The owner, at the till with a drawer open, rings a sale. */
    private function sold(string $method = 'cash'): array
    {
        return $this->as($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $this->item['id'], 'quantity' => 1]],
            'payment_method' => $method, 'amount_paid' => 1450,
        ])->assertCreated()->json('data');
    }

    private function back(User $who, array $sale): array
    {
        $line = $sale['items'][0]['id'];

        return [
            'worth' => $this->as($who)->postJson("/api/v1/sales/{$sale['id']}/returns/worth", ['items' => [['sale_item_id' => $line, 'quantity' => 1]]])->assertOk()->json('data'),
            'done' => $this->as($who)->postJson("/api/v1/sales/{$sale['id']}/returns", ['items' => [['sale_item_id' => $line, 'quantity' => 1]]])->assertCreated()->json(),
        ];
    }

    public function test_with_no_shift_the_refunder_is_told_before_and_after(): void
    {
        $this->as($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertSuccessful();
        $sale = $this->sold();

        ['worth' => $worth, 'done' => $done] = $this->back($this->manager, $sale);

        $this->assertSame('none', $worth['drawer'], 'the returns desk was not told the cash lands in no drawer');
        $this->assertStringContainsString('no shift open', implode(' ', $done['meta']['warnings'] ?? []), 'a cash refund no drawer counted was saved without a word');
        $this->assertNull(SaleReturn::withoutTenancy()->sole()->cash_session_id);

        // And it did not reach into the cashier's drawer either: hers still
        // expects the sale, because nobody took it out of HER count.
        $drawer = $this->as($this->owner)->getJson('/api/v1/pos/session/report')->assertOk()->json('data.drawer');
        $this->assertSame(0.0, (float) $drawer['cash_refunds']);
    }

    public function test_with_their_own_shift_the_cash_comes_off_their_count(): void
    {
        $this->as($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertSuccessful();
        $sale = $this->sold();
        $this->as($this->manager)->postJson('/api/v1/pos/session/open', ['opening_float' => 2000])->assertSuccessful();

        ['worth' => $worth, 'done' => $done] = $this->back($this->manager, $sale);

        $this->assertSame('open', $worth['drawer']);
        $this->assertEmpty($done['meta']['warnings'] ?? [], 'a refund from the refunder\'s own drawer was warned about');
        $drawer = $this->as($this->manager)->getJson('/api/v1/pos/session/report')->assertOk()->json('data.drawer');
        $this->assertSame(1450.0, (float) $drawer['cash_refunds']);
        $this->assertSame(550.0, (float) $drawer['expected_cash'], 'her drawer still expects the 1,450 she handed back');
    }

    public function test_a_card_refund_touches_no_drawer_and_warns_of_none(): void
    {
        $sale = $this->sold('card');

        ['done' => $done] = $this->back($this->manager, $sale);

        $this->assertEmpty($done['meta']['warnings'] ?? []);
    }

    public function test_a_business_with_no_till_is_not_told_about_drawers(): void
    {
        // A books-only business has no drawer to mention (BooksDrawer::hasTill).
        $this->assertSame('none', BooksDrawer::stateFor($this->manager));
        $this->shop->forceFill(['features' => array_merge($this->shop->features ?? [], ['pos' => false])])->save();

        $this->assertNull(BooksDrawer::stateFor($this->manager->fresh()));
    }
}
