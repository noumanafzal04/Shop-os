<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\CashSession;
use App\Models\SaleReturn;
use App\Models\Tenant;
use App\Models\User;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A REFUND LEAVES THE DRAWER IT CAME OUT OF — WITH A SUPERVISOR'S YES.
 *
 * Tester pass 1 (B01): Saad, a supervisor with no shift, refunded 2,500 at
 * Bilal's counter. The notes left Bilal's drawer; the refund belonged to no
 * drawer; Bilal closed short. The owner (2026-10-14): the refund leaves the
 * cashier's drawer, the supervisor approves with their PIN, and the approval,
 * the amount, the cashier, the supervisor and the drawer are kept.
 */
class ARefundLeavesTheDrawerItCameOutOfTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $bilal;

    private User $saad;

    private string $kurta;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $owner = User::factory()->shopOwner($this->shop)->create();
        $this->bilal = $this->preset('cashier', 'Bilal');
        $this->saad = $this->preset('shift_supervisor', 'Saad');
        $this->saad->setPin('2580');
        $this->bilal->setPin('3691');
        $this->kurta = $this->as($owner)->postJson('/api/v1/products', [
            'name' => 'Lawn Kurta', 'item_type' => 'physical_product', 'price' => 2500, 'track_inventory' => false,
        ])->assertCreated()->json('data.id');

        $this->as($this->bilal)->postJson('/api/v1/pos/session/open', ['opening_float' => 2000])->assertSuccessful();
    }

    private function preset(string $code, string $name): User
    {
        return User::factory()->create([
            'tenant_id' => $this->shop->id, 'role' => 'staff', 'name' => $name,
            'permissions' => collect(StaffPresets::all())->firstWhere('code', $code)['permissions'],
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function bilalsDrawer(): CashSession
    {
        return CashSession::withoutTenancy()->where('user_id', $this->bilal->id)->where('status', 'open')->sole();
    }

    /** Bilal rings a kurta for cash on his own shift. */
    private function sold(): array
    {
        return $this->as($this->bilal)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $this->kurta, 'quantity' => 1]], 'payment_method' => 'cash', 'amount_paid' => 2500,
        ])->assertCreated()->json('data');
    }

    private function back(User $who, array $sale, array $extra = []): TestResponse
    {
        return $this->as($who)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ] + $extra);
    }

    private function expected(): float
    {
        return (float) $this->as($this->bilal)->getJson('/api/v1/pos/session/report')->assertOk()->json('data.drawer.expected_cash');
    }

    public function test_the_supervisor_refunds_out_of_the_cashiers_drawer_with_their_own_pin(): void
    {
        $sale = $this->sold();
        $this->assertEquals(4500, $this->expected());

        $this->back($this->saad, $sale, [
            'cash_session_id' => $this->bilalsDrawer()->id,
            'approval' => ['user_id' => $this->saad->id, 'pin' => '2580'],
        ])->assertCreated();

        $this->assertEquals(2000, $this->expected(), "the 2,500 handed back did not come off Bilal's drawer");
        $return = SaleReturn::withoutTenancy()->sole();
        $this->assertSame($this->bilalsDrawer()->id, $return->cash_session_id);
        $this->assertSame($this->saad->id, $return->approved_by);
        $this->assertNotNull($return->approved_at);

        $trail = AuditLog::query()->where('event', 'approved')->sole();
        $this->assertSame($this->saad->id, $trail->user_id);
        $this->assertEquals(2500, $trail->new_values['amount']);
        $this->assertSame('Bilal', $trail->new_values['drawer_of']);
        $this->assertSame('Saad', $trail->new_values['approved_by']);
    }

    /**
     * A drawer cannot hand back more than it holds — the rule a pay-out keeps.
     *
     * Money pass 2026-10-16 ($6): 3,509.99 went back out of a drawer opened
     * with 2,000, with no word on the sheet; the till then expected
     * −1,509.99, and refused a pay-out of 500 for being more than it held.
     */
    public function test_a_refund_is_not_handed_out_of_a_drawer_that_does_not_hold_it(): void
    {
        $this->as($this->saad)->postJson('/api/v1/pos/session/open', ['opening_float' => 0])->assertSuccessful();
        $sale = $this->as($this->saad)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $this->kurta, 'quantity' => 2]], 'payment_method' => 'cash', 'amount_paid' => 5000,
        ])->assertCreated()->json('data');

        // Out of Bilal's 2,000: refused in words, and nothing is written.
        $refused = $this->back($this->saad, $sale, [
            'cash_session_id' => $this->bilalsDrawer()->id,
            'approval' => ['user_id' => $this->saad->id, 'pin' => '2580'],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'INSUFFICIENT_DRAWER_CASH');
        $this->assertStringContainsString('2,000.00', (string) $refused->json('message'));
        $this->assertStringContainsString('2,500.00', (string) $refused->json('message'));
        $this->assertSame(0, SaleReturn::withoutTenancy()->count());
        $this->assertEquals(2000, $this->expected(), 'a refused refund moved the drawer');

        // The sheet is told first what the person's own drawer holds…
        $worth = $this->as($this->saad)->postJson("/api/v1/sales/{$sale['id']}/returns/worth", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertOk()->json('data');
        $this->assertEquals(5000, $worth['drawer_holds']);
        $this->assertEquals(2500, $worth['handed_back']);

        // …and out of a drawer that holds it, the refund goes.
        $this->back($this->saad, $sale)->assertCreated();
    }

    public function test_another_drawer_is_never_named_without_a_pin_and_a_wrong_pin_hands_nothing_back(): void
    {
        $sale = $this->sold();
        $drawer = $this->bilalsDrawer()->id;

        $this->back($this->saad, $sale, ['cash_session_id' => $drawer])->assertStatus(422);
        $this->back($this->saad, $sale, ['cash_session_id' => $drawer, 'approval' => ['user_id' => $this->saad->id, 'pin' => '1470']])->assertStatus(401);
        // A cashier's PIN cannot say yes to a refund.
        $this->back($this->saad, $sale, ['cash_session_id' => $drawer, 'approval' => ['user_id' => $this->bilal->id, 'pin' => '3691']])
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'APPROVER_CANNOT');

        $this->assertSame(0, SaleReturn::withoutTenancy()->count());
        $this->assertEquals(4500, $this->expected());
    }

    public function test_the_cashier_starts_it_and_the_supervisor_types_the_pin_on_the_cashiers_screen(): void
    {
        $sale = $this->sold();

        $this->back($this->bilal, $sale)->assertStatus(403)->assertJsonPath('meta.error_code', 'APPROVAL_REQUIRED');
        $this->back($this->bilal, $sale, ['approval' => ['user_id' => $this->saad->id, 'pin' => '2580']])->assertCreated();

        $this->assertEquals(2000, $this->expected(), "the refund did not come out of Bilal's own drawer");
        $this->assertSame($this->saad->id, SaleReturn::withoutTenancy()->sole()->approved_by);
    }

    public function test_a_drawer_at_another_place_is_refused_even_with_a_pin(): void
    {
        $sale = $this->sold();
        $outlet = Branch::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Gulberg Outlet', 'is_active' => true, 'is_default' => false]);
        $there = CashSession::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'user_id' => $this->preset('cashier', 'Hira')->id, 'branch_id' => $outlet->id,
            'status' => 'open', 'opening_float' => 1000, 'opened_at' => now(),
        ]);

        $this->back($this->saad, $sale, ['cash_session_id' => $there->id, 'approval' => ['user_id' => $this->saad->id, 'pin' => '2580']])
            ->assertStatus(422);
        $this->assertSame(0, SaleReturn::withoutTenancy()->count());
    }

    public function test_an_exchange_by_the_supervisor_moves_the_cash_through_the_cashiers_drawer(): void
    {
        $sale = $this->sold();
        $scarf = $this->as(User::query()->where('tenant_id', $this->shop->id)->where('role', 'shop_owner')->first())->postJson('/api/v1/products', [
            'name' => 'Silk Scarf', 'item_type' => 'physical_product', 'price' => 1000, 'track_inventory' => false,
        ])->assertCreated()->json('data.id');

        $done = $this->as($this->saad)->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'items' => [['product_id' => $scarf, 'quantity' => 1]], 'payments' => [], 'channel' => 'pos',
            'cash_session_id' => $this->bilalsDrawer()->id,
            'approval' => ['user_id' => $this->saad->id, 'pin' => '2580'],
        ])->assertCreated()->json('data');

        $this->assertEquals(1500, (float) $done['sale']['change_due']);
        $this->assertEquals(3000, $this->expected(), "the 1,500 handed back did not come off Bilal's drawer");
        $this->assertSame($this->saad->id, SaleReturn::withoutTenancy()->sole()->approved_by);
    }
}
