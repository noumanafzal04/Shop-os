<?php

namespace Tests\Feature;

use App\Models\BankDeposit;
use App\Models\Branch;
use App\Models\BusinessDay;
use App\Models\CashSession;
use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\DenominationCount;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * How a drawer is actually counted out.
 *
 * The first pass reconciled a shift against one typed number, and that number
 * is where cash control quietly fails:
 *
 *   A cashier who types a total has already done the arithmetic in their head,
 *   and the drawer's real composition — the only thing another person could
 *   re-check — is gone.
 *
 *   A till that shows "expected 47,320" before the count gets a count of
 *   47,320. Often not dishonestly: a human who knows the answer stops counting
 *   when they reach it.
 *
 *   And no shift, however well counted, answers what the owner asks at 10pm —
 *   what did the shop take today, and how much went to the bank.
 */
class ShiftReportingTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $cashier;

    private Product $rice;

    /** The shift the helper sales ring on — the API takes it explicitly. */
    private ?string $sessionId = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Faisalabad', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'timezone' => 'UTC',
        ]);

        $this->owner = User::factory()->shopOwner($this->shop)->create(['name' => 'Owner']);
        $this->cashier = User::factory()
            ->tenantStaff($this->shop, ['sales.manage'])->create(['name' => 'Adeel']);

        $this->rice = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => 'Basmati 5kg', 'price' => 2500, 'cost' => 2000,
            'track_inventory' => true, 'stock_quantity' => 100, 'is_active' => true,
        ]);
    }

    // ── Counting by denomination ────────────────────────────────────

    public function test_a_drawer_counted_by_note_and_coin_derives_its_own_total(): void
    {
        $this->openShift(5000);

        // 3×1000 + 4×500 + 10×100 = 6,000. The cashier never types a total,
        // so there is nothing for them to round in their head.
        $closed = $this->closeShift(['1000' => 3, '500' => 4, '100' => 10]);

        $this->assertEquals(6000, $closed['counted_cash']);
        $this->assertSame(['1000' => 3, '500' => 4, '100' => 10], $closed['closing_denominations']);
    }

    public function test_the_breakdown_wins_over_a_typed_total(): void
    {
        $this->openShift(5000);

        // A count and a total that disagree is a count nobody did. Preferring
        // the typed figure would hide exactly the error the breakdown exists
        // to catch.
        $closed = $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/close', [
            'counted_cash' => 9999,
            'denominations' => ['1000' => 5],
        ])->assertOk()->json('data');

        $this->assertEquals(5000, $closed['counted_cash']);
    }

    public function test_a_client_that_can_only_type_a_total_still_works(): void
    {
        $this->openShift(5000);

        $closed = $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => 5000])
            ->assertOk()->json('data');

        $this->assertEquals(5000, $closed['counted_cash']);
        $this->assertNull($closed['closing_denominations']);
    }

    public function test_zero_rows_are_dropped_so_the_slip_stays_readable(): void
    {
        $this->openShift(1000);

        $closed = $this->closeShift(['5000' => 0, '1000' => 1, '500' => 0, '100' => 0]);

        $this->assertSame(['1000' => 1], $closed['closing_denominations']);
    }

    public function test_the_opening_float_can_be_counted_the_same_way(): void
    {
        $session = $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/open', [
            'opening_float' => 0,
            'denominations' => ['500' => 4, '100' => 5],
        ])->assertCreated()->json('data');

        $this->assertEquals(2500, $session['opening_float']);
    }

    public function test_an_unknown_denomination_is_ignored_rather_than_guessed_at(): void
    {
        // A shop on another currency gets no total from a PKR breakdown, which
        // is visible — rather than a wrong one, which isn't.
        $this->assertEquals(1000, DenominationCount::total(['1000' => 1, '250' => 4]));
    }

    // ── Blind close ─────────────────────────────────────────────────

    public function test_blind_close_withholds_the_answer_from_the_person_being_marked(): void
    {
        $this->setSetting('pos_blind_close', true);
        $this->openShift(5000);
        $this->sell(2500);

        // The X-read still shows everything the cashier DID — take that away
        // and it stops being useful for tracing a variance to its cause.
        $read = $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/session/report')->assertOk()->json('data');

        $this->assertTrue($read['blind_close']);
        $this->assertArrayNotHasKey('expected_cash', $read['drawer']);
        $this->assertArrayHasKey('sales_count', $read['drawer']);

        // …and the close response withholds it too. Returning it there would
        // teach the cashier what to count to next time.
        $closed = $this->closeShift(['1000' => 7, '500' => 1]);
        $this->assertNull($closed['expected_cash']);
        $this->assertNull($closed['variance']);
    }

    public function test_a_manager_sees_the_figures_a_blind_shift_hid(): void
    {
        $this->setSetting('pos_blind_close', true);
        $this->openShift(5000);
        $this->sell(2500);
        $this->closeShift(['1000' => 7, '500' => 1]);

        // Reconciling is the manager's job and they are not the one being
        // checked, so the Z-read is complete for them.
        $session = CashSession::withoutTenancy()->where('user_id', $this->cashier->id)->firstOrFail();

        $z = $this->actingAsUser($this->owner)
            ->getJson("/api/v1/pos/sessions/{$session->id}/z-report")->assertOk()->json('data');

        $this->assertEquals(7500, $z['session']['expected_cash']);
        $this->assertEquals(0, $z['session']['variance']);
        $this->assertTrue($z['session']['blind_close']);
    }

    public function test_a_shift_records_how_it_was_counted_not_how_the_setting_reads_later(): void
    {
        $this->setSetting('pos_blind_close', true);
        $this->openShift(1000);
        $this->closeShift(['1000' => 1]);

        // Turning the setting off next month must not rewrite how last
        // month's counts were taken.
        $this->setSetting('pos_blind_close', false);

        $session = CashSession::withoutTenancy()->where('user_id', $this->cashier->id)->firstOrFail();
        $this->assertTrue((bool) $session->blind_close);
    }

    public function test_an_ordinary_shop_is_not_blinded_by_default(): void
    {
        $this->openShift(5000);

        $read = $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/session/report')->assertOk()->json('data');

        // In a one-person shop the owner IS the cashier, and hiding their own
        // number from them is theatre.
        $this->assertFalse($read['blind_close']);
        $this->assertEquals(5000, $read['drawer']['expected_cash']);
    }

    // ── Declared tenders ────────────────────────────────────────────

    public function test_a_declared_card_total_is_measured_against_what_the_pos_rang(): void
    {
        $this->openShift(1000);
        $this->sell(2500, method: 'card');

        // The terminal's batch says 3,000; the POS rang 2,500. Catching that
        // here, with the cashier still standing there, is the entire point.
        $closed = $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/close', [
            'counted_cash' => 1000,
            'declared_tenders' => ['card' => 3000],
        ])->assertOk()->json('data');

        $this->assertEquals(500, $closed['tender_variances']['card']);
    }

    public function test_a_tender_the_pos_never_rang_is_the_more_interesting_finding(): void
    {
        $this->openShift(1000);

        // Money through a terminal and not through here.
        $closed = $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/close', [
            'counted_cash' => 1000,
            'declared_tenders' => ['card' => 4200],
        ])->assertOk()->json('data');

        $this->assertEquals(4200, $closed['tender_variances']['card']);
    }

    public function test_declaring_nothing_leaves_no_tender_variance_at_all(): void
    {
        $this->openShift(1000);
        $closed = $this->closeShift(['1000' => 1]);

        // A cash-only shop has nothing to declare, and inventing a zero
        // variance would put a line on the Z-read that means nothing.
        $this->assertNull($closed['tender_variances']);
    }

    // ── The Z-read ──────────────────────────────────────────────────

    public function test_a_z_read_is_only_for_a_counted_drawer(): void
    {
        $session = $this->openShift(5000);

        $this->actingAsUser($this->cashier)
            ->getJson("/api/v1/pos/sessions/{$session['id']}/z-report")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'SHIFT_NOT_CLOSED');
    }

    public function test_a_z_read_keeps_its_figures_when_the_sale_behind_them_is_voided(): void
    {
        $this->openShift(1000);
        $saleId = $this->sell(2500);
        $this->closeShift(['1000' => 3, '500' => 1]);

        $session = CashSession::withoutTenancy()->where('user_id', $this->cashier->id)->firstOrFail();

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$saleId}/cancel", [
            'reason_code' => 'wrong_item',
        ])->assertOk();

        // A report that changes retroactively is not evidence of anything —
        // and this is the document a shop reaches for when a shift is
        // disputed weeks later.
        $z = $this->actingAsUser($this->owner)
            ->getJson("/api/v1/pos/sessions/{$session->id}/z-report")->assertOk()->json('data');

        $this->assertEquals(1, $z['session']['sales_count']);
        $this->assertEquals(2500, $z['session']['sales_total']);
        $this->assertEquals(3500, $z['session']['expected_cash']);
    }

    public function test_the_z_read_prints(): void
    {
        $this->openShift(1000);
        $this->closeShift(['1000' => 1]);

        $session = CashSession::withoutTenancy()->where('user_id', $this->cashier->id)->firstOrFail();

        $this->actingAsUser($this->cashier)
            ->get("/api/v1/pos/sessions/{$session->id}/z-report/print?paper=thermal_80")
            ->assertOk()
            ->assertSee('END OF SHIFT')
            ->assertSee('DRAWER BALANCED');
    }

    // ── The trading day ─────────────────────────────────────────────

    public function test_the_first_shift_of_the_day_opens_the_day(): void
    {
        // Making the owner remember to "start the day" before anyone can sell
        // would strand a shop at 7am for a step that carries no decision.
        $session = $this->openShift(5000);

        $this->assertNotNull($session['business_day_id']);
        $this->assertSame(1, BusinessDay::withoutTenancy()->where('tenant_id', $this->shop->id)->count());
    }

    public function test_two_cashiers_on_the_same_day_share_one_day(): void
    {
        $second = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create(['name' => 'Sana']);

        $a = $this->openShift(5000);
        $b = $this->actingAsUser($second)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => 3000])
            ->assertCreated()->json('data');

        $this->assertSame($a['business_day_id'], $b['business_day_id']);
    }

    public function test_a_day_cannot_be_closed_over_a_running_shift(): void
    {
        $session = $this->openShift(5000);

        // The day's totals are summed from frozen close figures, and a shift
        // still selling has none — it would under-report by a whole drawer.
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/pos/days/{$session['business_day_id']}/close", [])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'SHIFTS_STILL_OPEN');
    }

    public function test_closing_the_day_rolls_up_every_shift_that_belonged_to_it(): void
    {
        $second = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create(['name' => 'Sana']);

        $session = $this->openShift(5000);
        $this->sell(2500);
        $this->closeShift(['1000' => 7, '500' => 1]);

        $this->actingAsUser($second)->postJson('/api/v1/pos/session/open', ['opening_float' => 3000])->assertCreated();
        $this->actingAsUser($second)->postJson('/api/v1/pos/session/close', [
            'counted_cash' => 2800,
        ])->assertOk();

        $day = $this->actingAsUser($this->owner)
            ->postJson("/api/v1/pos/days/{$session['business_day_id']}/close", [])
            ->assertOk()->json('data');

        $this->assertSame('closed', $day['status']);
        $this->assertSame(2, $day['shifts_count']);
        $this->assertEquals(8000, $day['opening_float']);
        $this->assertEquals(10300, $day['counted_cash']);

        // One lane 200 short, one exact. Summed rather than netted from the
        // totals — a day where one lane is over and another short by the same
        // amount is two problems, not none.
        $this->assertEquals(-200, $day['variance']);
    }

    public function test_a_closed_day_cannot_be_closed_twice(): void
    {
        $session = $this->openShift(1000);
        $this->closeShift(['1000' => 1]);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/pos/days/{$session['business_day_id']}/close", [])->assertOk();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/pos/days/{$session['business_day_id']}/close", [])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'BUSINESS_DAY_CLOSED');
    }

    public function test_closing_off_a_day_is_a_managers_signature_not_a_cashiers(): void
    {
        $session = $this->openShift(1000);
        $this->closeShift(['1000' => 1]);

        // It is the sign-off on every cashier's variance, which is not a thing
        // a cashier signs for themselves.
        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/pos/days/{$session['business_day_id']}/close", [])
            ->assertForbidden();
    }

    public function test_the_day_screen_counts_a_shift_that_is_still_selling(): void
    {
        $this->openShift(5000);
        $this->sell(2500);
        $this->sell(2500, 'card');

        $view = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/pos/day')->assertOk()->json('data');

        // A shift's columns are frozen at close, so reading them alone shows a
        // shop that has taken nothing — at exactly the hour an owner checks.
        $this->assertEquals(5000, $view['running']['sales_total']);
        $this->assertSame(2, $view['running']['sales_count']);
        // Only the cash leg belongs in a drawer.
        $this->assertEquals(2500, $view['running']['cash_sales']);
        $this->assertEquals(7500, $view['running']['expected_cash']);
        $this->assertSame(1, $view['running']['open_shifts']);

        // Counting is what a closed shift has. An open one is not accused of a
        // variance while its cashier is still working.
        $this->assertEquals(0, $view['running']['counted_cash']);
        $this->assertEquals(0, $view['running']['variance']);

        $this->assertEquals(5000, $view['sessions'][0]['live']['sales_total']);
    }

    public function test_a_closed_shift_keeps_the_figure_it_was_signed_off_on(): void
    {
        $this->openShift(5000);
        $this->sell(2500);
        $this->closeShift(['1000' => 7, '500' => 1]);

        $view = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/pos/day')->assertOk()->json('data');

        // Frozen, not recomputed — a counted drawer must read the same tomorrow.
        $this->assertArrayNotHasKey('live', $view['sessions'][0]);
        $this->assertEquals(2500, $view['running']['sales_total']);
        $this->assertEquals(7500, $view['running']['counted_cash']);
        $this->assertSame(0, $view['running']['open_shifts']);
    }

    // ── Banking ─────────────────────────────────────────────────────

    public function test_the_day_screen_shows_what_is_still_in_the_shop(): void
    {
        $this->openShift(5000);
        $this->sell(5000);

        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/pos/deposits', ['amount' => 3000, 'bank_name' => 'Meezan'])
            ->assertCreated();

        $view = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/pos/day')->assertOk()->json('data');

        $this->assertEquals(3000, $view['banked']);
        // Takings minus what went to the bank. The 5,000 float is not today's
        // money and stays for tomorrow, so it is not in this number.
        $this->assertEquals(2000, $view['unbanked']);
        $this->assertCount(1, $view['deposits']);
    }

    public function test_banking_records_the_leg_nothing_else_covers(): void
    {
        $session = $this->openShift(5000);

        $deposit = $this->actingAsUser($this->owner)->postJson('/api/v1/pos/deposits', [
            'amount' => 40000,
            'bank_name' => 'Meezan',
            'slip_number' => 'DEP-99213',
        ])->assertCreated()->json('data');

        $this->assertEquals(40000, $deposit['amount']);
        $this->assertSame($session['business_day_id'], $deposit['business_day_id']);
    }

    public function test_a_deposit_never_takes_the_same_rupees_out_of_a_drawer_twice(): void
    {
        $this->openShift(5000);

        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/pos/deposits', ['amount' => 3000])->assertCreated();

        // The money left the till hours earlier as a safe drop. Posting it
        // against the drawer again would show a phantom short on a shift that
        // balanced perfectly.
        $read = $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/session/report')->assertOk()->json('data');

        $this->assertEquals(5000, $read['drawer']['expected_cash']);
    }

    public function test_the_day_reports_what_went_to_the_bank(): void
    {
        $session = $this->openShift(1000);
        $this->actingAsUser($this->owner)->postJson('/api/v1/pos/deposits', ['amount' => 25000])->assertCreated();
        $this->closeShift(['1000' => 1]);

        $day = $this->actingAsUser($this->owner)
            ->postJson("/api/v1/pos/days/{$session['business_day_id']}/close", [])
            ->assertOk()->json('data');

        $this->assertEquals(25000, $day['banked_amount']);
        $this->assertSame(1, BankDeposit::withoutTenancy()->where('tenant_id', $this->shop->id)->count());
    }

    // ── What the dashboard says about the till ──────────────────────

    public function test_the_dashboard_knows_the_day_is_open_and_who_is_on_it(): void
    {
        $this->openShift(5000);
        $this->actingAsUser($this->owner)->postJson('/api/v1/pos/deposits', ['amount' => 2000])->assertCreated();

        $till = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/dashboard')->assertOk()->json('data.till');

        $this->assertTrue($till['day_open']);
        $this->assertSame(1, $till['open_shifts']);
        $this->assertEquals(2000, $till['banked_today']);
        $this->assertNull($till['unclosed_day']);
    }

    public function test_the_dashboard_names_a_day_nobody_ever_closed_off(): void
    {
        $this->travelTo(now()->subDays(3));
        $this->openShift(1000);
        $this->closeShift(['1000' => 1]);
        $this->travelBack();

        // The day was never closed off, so it never got its roll-up — the
        // shop's record of that Tuesday quietly does not exist. Nothing else
        // in the product would ever mention it.
        $till = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/dashboard')->assertOk()->json('data.till');

        $this->assertFalse($till['day_open']);
        $this->assertSame(now()->subDays(3)->toDateString(), $till['unclosed_day']);
        $this->assertSame(1, $till['unclosed_days']);
    }

    public function test_the_hq_view_counts_every_branch_still_selling(): void
    {
        $gulberg = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);
        // Staff are PINNED to their branch; a header would be ignored (and it
        // would also leak onto the owner's own request afterwards).
        $second = User::factory()->tenantStaff($this->shop, ['sales.manage'])
            ->create(['name' => 'Sana', 'branch_id' => $gulberg->id]);

        $this->openShift(5000);
        $this->actingAsUser($second)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => 3000])
            ->assertCreated();

        // A day belongs to a branch, so all-branches is looking at two of
        // today's days at once. Reporting one site's shifts as the chain's
        // would tell an owner every till was counted out while another
        // branch was still selling.
        $till = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/dashboard')->assertOk()->json('data.till');

        $this->assertTrue($till['day_open']);
        $this->assertSame(2, $till['open_shifts']);
    }

    public function test_an_online_only_shop_is_told_nothing_about_a_till_it_does_not_have(): void
    {
        $this->shop->forceFill(['features' => ['marketplace' => true, 'products' => true, 'pos' => false]])->save();

        $this->actingAsUser($this->owner)->getJson('/api/v1/dashboard')
            ->assertOk()
            ->assertJsonPath('data.till', null);
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /** @return array<string, mixed> */
    private function openShift(float $float): array
    {
        $session = $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => $float])
            ->assertCreated()->json('data');

        $this->sessionId = $session['id'];

        return $session;
    }

    /**
     * @param  array<string, int>  $denominations
     * @return array<string, mixed>
     */
    private function closeShift(array $denominations): array
    {
        return $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/close', [
            'counted_cash' => 0,
            'denominations' => $denominations,
        ])->assertOk()->json('data');
    }

    private function sell(float $amount, string $method = 'cash'): string
    {
        return $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            // The drawer is named explicitly and validated as the caller's own
            // (OwnOpenShift) — a cashier cannot ring onto someone else's lane.
            'cash_session_id' => $this->sessionId,
            'items' => [['product_id' => $this->rice->id, 'quantity' => $amount / 2500]],
            'payment_method' => $method,
            'amount_paid' => $amount,
        ])->assertCreated()->json('data.id');
    }

    private function setSetting(string $key, mixed $value): void
    {
        $settings = $this->shop->fresh()->settings ?? [];
        $settings[$key] = $value;
        $this->shop->forceFill(['settings' => $settings])->save();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
