<?php

namespace Tests\Feature;

use App\Models\Bank;
use App\Models\BankCardOffer;
use App\Models\Tenant;
use App\Services\BankOfferService;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * The engine alone, with no screen and no sale in front of it.
 *
 * The rules are worth pinning here rather than through the till, because every
 * one of them is a rupee figure the shop will later put on an invoice to a
 * bank. A discount computed wrongly is not a display bug — it is either money
 * the shop gave away and cannot claim back, or a claim the bank rejects a month
 * later with the goods long gone.
 */
class BankOfferEngineTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private Bank $bank;

    private BankOfferService $offers;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::factory()->create(['setup_completed' => true]);
        app(TenantContext::class)->set($this->tenant);

        $this->bank = Bank::query()->create([
            'tenant_id' => $this->tenant->id,
            'name' => 'HBL',
            'short_code' => 'HBL',
            'is_active' => true,
        ]);

        $this->offers = app(BankOfferService::class);
    }

    private function offer(array $over = []): BankCardOffer
    {
        return BankCardOffer::query()->create(array_merge([
            'tenant_id' => $this->tenant->id,
            'bank_id' => $this->bank->id,
            'label' => 'Ramadan 10%',
            'type' => 'percent',
            'value' => 10,
            'is_active' => true,
        ], $over));
    }

    /** A Friday afternoon, so weekday and time-window cases have somewhere to stand. */
    private function friday(string $time = '15:00:00'): Carbon
    {
        return Carbon::parse('2026-08-14 '.$time);
    }

    // ── What it takes off ───────────────────────────────────────────

    public function test_a_percentage_comes_off_the_card_amount(): void
    {
        $this->offer();

        $best = $this->offers->best($this->bank->id, 7000, $this->friday());

        $this->assertEqualsWithDelta(700.0, $best['discount'], 0.001);
    }

    public function test_a_fixed_amount_is_the_fixed_amount(): void
    {
        $this->offer(['type' => 'fixed', 'value' => 500]);

        $this->assertEqualsWithDelta(
            500.0,
            $this->offers->best($this->bank->id, 7000, $this->friday())['discount'],
            0.001,
        );
    }

    public function test_a_cap_holds_a_percentage_down(): void
    {
        // The reason a cap is not really optional: ten per cent of a
        // Rs 400,000 sale is a number neither the shop nor the bank agreed to.
        $this->offer(['max_discount' => 1000]);

        $this->assertEqualsWithDelta(
            1000.0,
            $this->offers->best($this->bank->id, 400000, $this->friday())['discount'],
            0.001,
        );
    }

    public function test_a_fixed_offer_can_never_exceed_what_the_card_was_paying(): void
    {
        // Rs 500 off a Rs 300 card slice would hand back money nobody tendered.
        $this->offer(['type' => 'fixed', 'value' => 500]);

        $this->assertEqualsWithDelta(
            300.0,
            $this->offers->best($this->bank->id, 300, $this->friday())['discount'],
            0.001,
        );
    }

    public function test_a_minimum_is_measured_against_the_car_d_amount(): void
    {
        // Not against the bill. The bank's condition is about its own
        // transaction — a shop reading it the other way would promise
        // "Rs 5,000 and above" to somebody paying Rs 200 by card.
        $this->offer(['min_spend' => 5000]);

        $this->assertNull($this->offers->best($this->bank->id, 4999, $this->friday()));
        $this->assertNotNull($this->offers->best($this->bank->id, 5000, $this->friday()));
    }

    public function test_nothing_is_offered_on_a_card_slice_of_zero(): void
    {
        $this->offer();

        $this->assertNull($this->offers->best($this->bank->id, 0, $this->friday()));
    }

    // ── When it runs ────────────────────────────────────────────────

    public function test_an_offer_that_has_not_started_does_nothing(): void
    {
        $this->offer(['starts_on' => '2026-09-01']);

        $this->assertNull($this->offers->best($this->bank->id, 7000, $this->friday()));
    }

    public function test_an_offer_that_has_ended_does_nothing(): void
    {
        $this->offer(['ends_on' => '2026-08-01']);

        $this->assertNull($this->offers->best($this->bank->id, 7000, $this->friday()));
    }

    public function test_a_weekend_only_offer_does_not_fire_on_a_friday(): void
    {
        // 0 = Sunday, matching the promotion engine and the stored column.
        $this->offer(['days_of_week' => [0, 6]]);

        $this->assertNull($this->offers->best($this->bank->id, 7000, $this->friday()));
        $this->assertNotNull(
            $this->offers->best($this->bank->id, 7000, Carbon::parse('2026-08-15 15:00:00')),
        );
    }

    public function test_an_evening_offer_does_not_fire_at_two_in_the_afternoon(): void
    {
        $this->offer(['start_time' => '18:00:00', 'end_time' => '21:00:00']);

        $this->assertNull($this->offers->best($this->bank->id, 7000, $this->friday('14:00:00')));
        $this->assertNotNull($this->offers->best($this->bank->id, 7000, $this->friday('19:00:00')));
    }

    public function test_a_window_that_wraps_midnight_is_a_real_window(): void
    {
        // 22:00–02:00 read naively is empty, and the offer simply never fires
        // while nobody can work out why. Shared with the promotion engine.
        $this->offer(['start_time' => '22:00:00', 'end_time' => '02:00:00']);

        $this->assertNotNull($this->offers->best($this->bank->id, 7000, $this->friday('23:30:00')));
        $this->assertNotNull($this->offers->best($this->bank->id, 7000, $this->friday('01:00:00')));
        $this->assertNull($this->offers->best($this->bank->id, 7000, $this->friday('12:00:00')));
    }

    public function test_a_switched_off_offer_does_nothing(): void
    {
        $this->offer(['is_active' => false]);

        $this->assertNull($this->offers->best($this->bank->id, 7000, $this->friday()));
    }

    // ── Which card ──────────────────────────────────────────────────

    public function test_an_offer_with_no_card_types_covers_any_card(): void
    {
        // The commonest deal, and the safe reading of a field nobody filled in.
        $this->offer();

        $this->assertNotNull($this->offers->best($this->bank->id, 7000, $this->friday(), 'debit'));
        $this->assertNotNull($this->offers->best($this->bank->id, 7000, $this->friday(), null));
    }

    public function test_a_credit_only_offer_refuses_a_debit_card(): void
    {
        $this->offer(['card_types' => ['credit']]);

        $this->assertNull($this->offers->best($this->bank->id, 7000, $this->friday(), 'debit'));
        $this->assertNotNull($this->offers->best($this->bank->id, 7000, $this->friday(), 'credit'));
    }

    public function test_a_credit_only_offer_refuses_a_card_nobody_typed_the_kind_of(): void
    {
        // The shop would otherwise file a claim the bank rejects, and find out
        // a month later with the money already given away.
        $this->offer(['card_types' => ['credit']]);

        $this->assertNull($this->offers->best($this->bank->id, 7000, $this->friday(), null));
    }

    // ── Which one, when there are several ───────────────────────────

    public function test_the_larger_of_two_offers_wins(): void
    {
        $this->offer(['label' => 'Small', 'value' => 5]);
        $this->offer(['label' => 'Big', 'value' => 15]);

        $this->assertSame('Big', $this->offers->best($this->bank->id, 7000, $this->friday())['offer']->label);
    }

    public function test_a_tie_goes_to_the_higher_priority(): void
    {
        $this->offer(['label' => 'Quiet', 'value' => 10, 'priority' => 0]);
        $this->offer(['label' => 'Loud', 'value' => 10, 'priority' => 5]);

        $this->assertSame('Loud', $this->offers->best($this->bank->id, 7000, $this->friday())['offer']->label);
    }

    public function test_another_banks_offer_is_never_reached(): void
    {
        $other = Bank::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Meezan', 'is_active' => true,
        ]);
        BankCardOffer::query()->create([
            'tenant_id' => $this->tenant->id, 'bank_id' => $other->id,
            'label' => 'Meezan 50%', 'type' => 'percent', 'value' => 50, 'is_active' => true,
        ]);

        // HBL has nothing running, so the customer gets nothing — not Meezan's.
        $this->assertNull($this->offers->best($this->bank->id, 7000, $this->friday()));
    }

    public function test_another_shops_offer_is_never_reached(): void
    {
        // The offers belong to the shop that signed the deal. A tenant-scoped
        // model makes this true by construction; the test says so out loud
        // because the claim report is money.
        $otherShop = Tenant::factory()->create(['setup_completed' => true]);
        $theirBank = Bank::query()->create([
            'tenant_id' => $otherShop->id, 'name' => 'HBL', 'is_active' => true,
        ]);
        BankCardOffer::query()->create([
            'tenant_id' => $otherShop->id, 'bank_id' => $theirBank->id,
            'label' => 'Theirs', 'type' => 'percent', 'value' => 25, 'is_active' => true,
        ]);

        $this->assertNull($this->offers->best($theirBank->id, 7000, $this->friday()));
    }
}
