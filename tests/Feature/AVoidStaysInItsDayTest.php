<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\CashMovement;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A SALE RUNG IN ERROR IS VOIDED THE SAME DAY, OR NOT AT ALL.
 *
 * The owner, answering a client's question (Q18, 2026-10-17): no invoice is
 * ever deleted. A void is allowed only within the sale's own shop-day, while
 * that day is not closed off; after it the goods come back through Return /
 * Refund. A cashier may start a void, a manager's PIN finishes it. The cash
 * goes back out of an open drawer that holds it — never out of no drawer
 * (B86: a void by somebody with no shift open recorded the notes nowhere,
 * and a void never asked whether the drawer held them).
 */
class AVoidStaysInItsDayTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private User $cashier;

    private User $manager;

    /** May approve a refund, not a void. */
    private User $clerk;

    private Product $rice;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        // Mid-afternoon in Karachi: the day turns at five in the morning.
        $this->travelTo(Carbon::parse('2026-10-17 15:00:00', 'Asia/Karachi'));

        $shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($shop)->create();
        $this->cashier = User::factory()->tenantStaff($shop, ['sales.manage'])->create(['name' => 'Ayesha']);
        $this->manager = User::factory()->tenantStaff($shop, ['sales.manage', 'sales.void'])->create(['name' => 'Hina']);
        $this->clerk = User::factory()->tenantStaff($shop, ['sales.manage', 'sales.refund'])->create(['name' => 'Farah']);
        $this->manager->setPin('1357');
        $this->clerk->setPin('2468');

        $this->rice = Product::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice 5kg', 'price' => 1000, 'cost' => 800, 'stock_quantity' => 100, 'track_inventory' => true,
        ]);
    }

    public function test_a_cashier_starts_it_and_only_a_pin_that_may_void_finishes_it(): void
    {
        $shift = $this->openShift($this->cashier, 2000);
        $sale = $this->ring($this->cashier, 'cash', $shift);

        $this->void($this->cashier, $sale)->assertStatus(403)->assertJsonPath('meta.error_code', 'APPROVAL_REQUIRED');
        $this->void($this->cashier, $sale, ['approval' => ['user_id' => $this->clerk->id, 'pin' => '2468']])
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'APPROVER_CANNOT');
        $this->assertNothingMoved($sale);

        $this->void($this->cashier, $sale, ['approval' => ['user_id' => $this->manager->id, 'pin' => '1357']])->assertOk();

        $this->assertSame('cancelled', Sale::withoutTenancy()->find($sale)->status->value);
        $this->assertEquals(100, $this->rice->fresh()->stock_quantity, 'the goods are back on the shelf');
        $back = CashMovement::withoutTenancy()->where('type', 'void_refund')->sole();
        $this->assertSame($shift, $back->cash_session_id, 'the notes left the drawer at the counter');
        $this->assertEquals(1000, $back->amount);
        $approved = AuditLog::query()->where('event', 'approved')->sole();
        $this->assertSame('Hina', $approved->new_values['approved_by']);
        $this->assertSame('Ayesha', $approved->new_values['done_by']);
        // 2000 float + 1000 taken − 1000 handed back.
        $this->assertEquals(0, $this->closeShift($this->cashier, 2000)['variance']);
    }

    public function test_the_night_belongs_to_the_evening_and_the_morning_after_is_too_late(): void
    {
        $this->travelTo(Carbon::parse('2026-10-17 23:00:00', 'Asia/Karachi'));
        $shift = $this->openShift($this->manager, 3000);
        $first = $this->ring($this->manager, 'cash', $shift);
        $second = $this->ring($this->manager, 'cash', $shift);

        // Half past one: still the evening's day — it turns at five.
        $this->travelTo(Carbon::parse('2026-10-18 01:30:00', 'Asia/Karachi'));
        $this->assertTrue($this->show($second)['open']);
        $this->void($this->manager, $first)->assertOk();

        // Ten in the morning: a new day. The second sale is the evening's.
        $this->travelTo(Carbon::parse('2026-10-18 10:00:00', 'Asia/Karachi'));
        $sheet = $this->show($second);
        $this->assertFalse($sheet['open'], 'the sheet must not offer a void the server will refuse');
        $this->assertStringContainsString('Return / Refund', $sheet['why_not']);
        $this->void($this->manager, $second)->assertStatus(409)->assertJsonPath('meta.error_code', 'SALE_DAY_OVER');
        $this->assertNothingMoved($second, onTheShelf: 99);
    }

    public function test_a_day_closed_off_is_over_until_it_is_reopened(): void
    {
        $shift = $this->openShift($this->manager, 3000);
        $sale = $this->ring($this->manager, 'cash', $shift);
        $day = $this->closeShift($this->manager, 4000)['business_day_id'];
        $this->as($this->owner)->postJson("/api/v1/pos/days/{$day}/close", [])->assertOk();

        // The same afternoon — the clock has not turned, but the day was signed.
        $this->travelTo(Carbon::parse('2026-10-17 16:00:00', 'Asia/Karachi'));
        $this->assertFalse($this->show($sale)['open']);
        $this->void($this->manager, $sale)->assertStatus(409)->assertJsonPath('meta.error_code', 'SALE_DAY_OVER');
        $this->assertNothingMoved($sale);

        // Opened again by a manager: the sale may be voided, out of a drawer.
        $this->as($this->owner)->postJson("/api/v1/pos/days/{$day}/reopen", ['reason' => 'Rung in error'])->assertOk();
        $this->openShift($this->manager, 3000);
        $this->assertTrue($this->show($sale)['open']);
        $this->void($this->manager, $sale)->assertOk();
    }

    public function test_cash_goes_back_only_out_of_an_open_drawer_that_holds_it(): void
    {
        $shift = $this->openShift($this->cashier, 0);
        $sale = $this->ring($this->cashier, 'cash', $shift);
        $this->as($this->cashier)->postJson('/api/v1/pos/session/movements', [
            'type' => 'drop', 'amount' => 600, 'reason' => 'To the safe',
        ])->assertCreated();

        // The manager has no shift: the notes would leave a drawer that never
        // heard of it. Refused, and nothing has moved.
        $sheet = $this->show($sale, $this->manager);
        $this->assertTrue($sheet['from_drawer']);
        $this->assertEquals(1000, $sheet['cash_back']);
        $this->assertSame('none', $sheet['drawer']);
        $this->void($this->manager, $sale)->assertStatus(409)->assertJsonPath('meta.error_code', 'VOID_NEEDS_A_DRAWER');
        $this->assertNothingMoved($sale);

        // Out of Ayesha's drawer, named, with the manager's own PIN — but it
        // holds 400 now. Refused the way a refund is (B78).
        $named = ['cash_session_id' => $shift, 'approval' => ['user_id' => $this->manager->id, 'pin' => '1357']];
        $this->void($this->manager, $sale, $named)->assertStatus(422)->assertJsonPath('meta.error_code', 'INSUFFICIENT_DRAWER_CASH');
        $this->assertNothingMoved($sale);

        $this->as($this->cashier)->postJson('/api/v1/pos/session/movements', [
            'type' => 'paid_in', 'amount' => 600, 'reason' => 'Back from the safe',
        ])->assertCreated();
        $this->void($this->manager, $sale, $named)->assertOk();
        $this->assertSame($shift, CashMovement::withoutTenancy()->where('type', 'void_refund')->sole()->cash_session_id);
    }

    public function test_no_drawer_is_asked_for_notes_no_drawer_took(): void
    {
        $shift = $this->openShift($this->cashier, 2000);

        // A card sale: nothing in notes goes back.
        $card = $this->ring($this->cashier, 'card', $shift);
        $this->void($this->manager, $card)->assertOk();

        // Cash taken with no shift open, in a shop that does not ask for one:
        // no drawer counted it in, so none hands it back — written out of
        // Ayesha's, her drawer would close over by exactly the sale.
        $loose = $this->ring($this->manager, 'cash');
        $this->assertNull(Sale::withoutTenancy()->find($loose)->cash_session_id);
        $this->assertFalse($this->show($loose)['from_drawer']);
        $this->void($this->cashier, $loose, ['approval' => ['user_id' => $this->manager->id, 'pin' => '1357']])->assertOk();

        $this->assertSame(0, CashMovement::withoutTenancy()->where('type', 'void_refund')->count());
        $this->assertEquals(0, $this->closeShift($this->cashier, 2000)['variance']);
    }

    private function assertNothingMoved(string $sale, float $onTheShelf = 99): void
    {
        $this->assertSame('completed', Sale::withoutTenancy()->find($sale)->status->value);
        $this->assertEquals($onTheShelf, $this->rice->fresh()->stock_quantity);
        $this->assertSame(0, CashMovement::withoutTenancy()->where('type', 'void_refund')->where('source_id', $sale)->count());
    }

    /** @return array<string, mixed> the sale sheet's `void` block */
    private function show(string $sale, ?User $who = null): array
    {
        return $this->as($who ?? $this->manager)->getJson("/api/v1/sales/{$sale}")->assertOk()->json('data.void');
    }

    private function void(User $who, string $sale, array $extra = []): TestResponse
    {
        return $this->as($who)->postJson("/api/v1/sales/{$sale}/cancel", ['reason_code' => 'wrong_item', ...$extra]);
    }

    private function ring(User $who, string $method, ?string $shift = null): string
    {
        return $this->as($who)->postJson('/api/v1/sales', array_filter([
            'channel' => 'pos', 'cash_session_id' => $shift, 'payment_method' => $method,
            'items' => [['product_id' => $this->rice->id, 'quantity' => 1]], 'amount_paid' => 1000,
        ], fn ($v) => $v !== null))->assertCreated()->json('data.id');
    }

    private function openShift(User $who, float $float): string
    {
        return $this->as($who)->postJson('/api/v1/pos/session/open', ['opening_float' => $float])->assertCreated()->json('data.id');
    }

    /** @return array<string, mixed> */
    private function closeShift(User $who, float $counted): array
    {
        return $this->as($who)->postJson('/api/v1/pos/session/close', ['counted_cash' => $counted])->assertOk()->json('data');
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
