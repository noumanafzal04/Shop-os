<?php

namespace Tests\Feature;

use App\Models\Bank;
use App\Models\BankCardOffer;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * The three doors onto bank offers, and who may open each.
 *
 * The split is the promotions one, for the promotions reason: signing a deal
 * with HBL is marketing, and honouring it is a cashier standing at a counter
 * with a customer's card in their hand. Requiring the marketing permission to
 * APPLY an offer would mean the only people who could accept one are the people
 * allowed to negotiate it — which is exactly the bug this codebase already paid
 * for once with coupons.
 */
class BankOfferEndpointTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $cashier;

    private User $marketer;

    private Bank $bank;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => array_merge(BusinessTypes::defaultFeatures('mart'), [
                // Bank card offers are their own module and no trade starts
                // with one — a discount a BANK funds is a mid-sized-retailer
                // arrangement. A file about bank offers has to ask for it.
                'promotions' => true, 'bank_offers' => true,
            ]),
            'timezone' => 'Asia/Karachi',
        ]);
        $this->cashier = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();
        $this->marketer = User::factory()->tenantStaff($this->tenant, ['coupons.manage'])->create();

        $this->bank = Bank::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'HBL', 'short_code' => 'HBL', 'is_active' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
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

    // ── Who may do what ─────────────────────────────────────────────

    public function test_a_cashier_may_read_what_is_running_but_not_change_it(): void
    {
        $this->actingAsUser($this->cashier)->getJson('/api/v1/banks/live')->assertOk();

        $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/banks', ['name' => 'Meezan'])
            ->assertStatus(403);
    }

    public function test_marketing_may_set_the_deals_up(): void
    {
        $this->actingAsUser($this->marketer)
            ->postJson('/api/v1/banks', ['name' => 'Meezan', 'short_code' => 'MZN'])
            ->assertCreated();
    }

    public function test_two_banks_of_the_same_name_are_refused(): void
    {
        // Not tidiness. Two rows called HBL split the claim report in half, and
        // the shop invoices for half of what it is owed without ever knowing.
        $this->actingAsUser($this->marketer)
            ->postJson('/api/v1/banks', ['name' => 'HBL'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('name');
    }

    public function test_another_shop_may_use_the_same_bank_name(): void
    {
        // Every shop signs its own deals — "HBL" is not a platform-wide row.
        // The other shop needs the module too, or "another shop may use the
        // same name" would pass on a 403 rather than on the name being free.
        $other = Tenant::factory()->create([
            'setup_completed' => true,
            'features' => ['promotions' => true, 'bank_offers' => true],
        ]);
        $theirMarketer = User::factory()->tenantStaff($other, ['coupons.manage'])->create();

        $this->actingAsUser($theirMarketer)
            ->postJson('/api/v1/banks', ['name' => 'HBL'])
            ->assertCreated();
    }

    // ── What a cashier is shown ─────────────────────────────────────

    public function test_a_bank_with_nothing_running_is_not_offered_at_the_counter(): void
    {
        // A dropdown of eleven banks where two have deals is a dropdown a
        // cashier stops reading by Tuesday.
        $this->actingAsUser($this->cashier)->getJson('/api/v1/banks/live')
            ->assertOk()->assertJsonPath('data', []);
    }

    public function test_a_bank_with_a_live_offer_is_offered_with_its_words(): void
    {
        $this->offer();

        $data = $this->actingAsUser($this->cashier)->getJson('/api/v1/banks/live')
            ->assertOk()->json('data');

        $this->assertCount(1, $data);
        $this->assertSame('HBL', $data[0]['name']);
        $this->assertSame('Ramadan 10%', $data[0]['offers'][0]['label']);
    }

    public function test_an_evening_offer_is_not_offered_in_the_afternoon(): void
    {
        // Judged in the SHOP's timezone. A till reading UTC would open a
        // Karachi evening offer five hours early and close it five hours early.
        $this->offer(['start_time' => '18:00:00', 'end_time' => '21:00:00']);

        $this->travelTo(Carbon::parse('2026-08-14 09:00:00', 'Asia/Karachi'));
        $this->actingAsUser($this->cashier)->getJson('/api/v1/banks/live')
            ->assertOk()->assertJsonPath('data', []);

        $this->travelTo(Carbon::parse('2026-08-14 19:00:00', 'Asia/Karachi'));
        $this->assertCount(
            1,
            $this->actingAsUser($this->cashier)->getJson('/api/v1/banks/live')->assertOk()->json('data'),
        );
    }

    public function test_a_switched_off_bank_disappears_from_the_counter(): void
    {
        $this->offer();
        $this->bank->update(['is_active' => false]);

        $this->actingAsUser($this->cashier)->getJson('/api/v1/banks/live')
            ->assertOk()->assertJsonPath('data', []);
    }

    // ── The quote ───────────────────────────────────────────────────

    public function test_the_quote_says_what_comes_off_and_what_is_left_to_tap(): void
    {
        $this->offer();

        $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/banks/quote', ['bank_id' => $this->bank->id, 'card_amount' => 7000])
            ->assertOk()
            ->assertJsonPath('data.discount', 700)
            ->assertJsonPath('data.card_payable', 6300)
            ->assertJsonPath('data.label', 'Ramadan 10%');
    }

    public function test_the_quote_says_zero_rather_than_failing_when_nothing_applies(): void
    {
        // A cashier must never meet an error here. Nothing running is an
        // ordinary answer, and the tender screen carries on as normal.
        $this->offer(['min_spend' => 10000]);

        $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/banks/quote', ['bank_id' => $this->bank->id, 'card_amount' => 500])
            ->assertOk()
            ->assertJsonPath('data.discount', 0)
            ->assertJsonPath('data.card_payable', 500)
            ->assertJsonPath('data.offer_id', null);
    }

    public function test_a_quote_for_another_shops_bank_reveals_nothing(): void
    {
        // Which deals a shop has signed is commercially theirs. Answering with
        // a discount would leak the terms; answering with a 404 would leak that
        // the bank exists. It answers zero, exactly like a bank with no offer.
        $other = Tenant::factory()->create(['setup_completed' => true]);
        $theirBank = Bank::query()->create([
            'tenant_id' => $other->id, 'name' => 'Theirs', 'is_active' => true,
        ]);
        BankCardOffer::query()->create([
            'tenant_id' => $other->id, 'bank_id' => $theirBank->id,
            'label' => 'Secret 40%', 'type' => 'percent', 'value' => 40, 'is_active' => true,
        ]);

        $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/banks/quote', ['bank_id' => $theirBank->id, 'card_amount' => 7000])
            ->assertOk()
            ->assertJsonPath('data.discount', 0)
            ->assertJsonPath('data.label', null);
    }

    public function test_the_quote_honours_a_credit_only_deal(): void
    {
        $this->offer(['card_types' => ['credit']]);

        $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/banks/quote', ['bank_id' => $this->bank->id, 'card_amount' => 7000])
            ->assertOk()->assertJsonPath('data.discount', 0);

        $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/banks/quote', [
                'bank_id' => $this->bank->id, 'card_amount' => 7000, 'card_type' => 'credit',
            ])
            ->assertOk()->assertJsonPath('data.discount', 700);
    }

    // ── Setting the deals up ────────────────────────────────────────

    public function test_an_offer_cannot_end_before_it_starts(): void
    {
        $this->actingAsUser($this->marketer)->postJson('/api/v1/bank-offers', [
            'bank_id' => $this->bank->id,
            'label' => 'Backwards',
            'type' => 'percent',
            'value' => 10,
            'starts_on' => '2026-09-01',
            'ends_on' => '2026-08-01',
        ])->assertStatus(422)->assertJsonValidationErrors('ends_on');
    }

    public function test_half_a_time_window_is_refused(): void
    {
        // One end alone says nothing about a window, and guessing the other is
        // how an offer ends up running for a minute a day.
        $this->actingAsUser($this->marketer)->postJson('/api/v1/bank-offers', [
            'bank_id' => $this->bank->id,
            'label' => 'Half a window',
            'type' => 'percent',
            'value' => 10,
            'start_time' => '18:00',
        ])->assertStatus(422)->assertJsonValidationErrors('end_time');
    }

    public function test_an_offer_cannot_be_hung_on_another_shops_bank(): void
    {
        $other = Tenant::factory()->create(['setup_completed' => true]);
        $theirBank = Bank::query()->create([
            'tenant_id' => $other->id, 'name' => 'Theirs', 'is_active' => true,
        ]);

        $this->actingAsUser($this->marketer)->postJson('/api/v1/bank-offers', [
            'bank_id' => $theirBank->id, 'label' => 'Nope', 'type' => 'percent', 'value' => 10,
        ])->assertStatus(422)->assertJsonValidationErrors('bank_id');
    }

    public function test_removing_a_bank_keeps_the_row_the_sales_point_at(): void
    {
        // The claim report reads back months. A hard delete would orphan the
        // money it is compiled from.
        $this->actingAsUser($this->marketer)
            ->deleteJson("/api/v1/banks/{$this->bank->id}")
            ->assertOk();

        $this->assertNotNull(Bank::withoutTenancy()->withTrashed()->find($this->bank->id));
    }
}
