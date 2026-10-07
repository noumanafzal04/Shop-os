<?php

namespace Tests\Feature;

use App\Actions\Pos\ReopenBusinessDayAction;
use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\BusinessDay;
use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * THE TILL'S DAY: WHICH ONE IT IS, AND THE WAY BACK FROM CLOSING THE WRONG ONE.
 *
 * Two things a shop met at the counter and the product had no answer for.
 *
 *   "Close off the day" pressed at two in the afternoon. No shift can open on
 *   a closed day, so with "a shift must be open to sell" switched on the shop
 *   had stopped trading until tomorrow.
 *
 *   A restaurant's shift opened at one in the morning started a SECOND trading
 *   day, dated by the calendar, beside the evening's that was still open.
 *
 * Both are the same question — which day is this counter trading? — and it
 * has one answer now (BusinessDay::tradingDateAt). These are its cases, rung
 * through the real doors with the clock moved for real.
 */
final class ADayClosedByMistakeTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'setup_completed' => true,
            'timezone' => 'Asia/Karachi',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $this->at('2026-10-06 09:00');
        $id = $this->as()->postJson('/api/v1/products', [
            'name' => 'Day Item', 'type' => 'product', 'item_type' => 'physical_product',
            'price' => 100, 'cost' => 60, 'track_inventory' => false,
        ])->assertCreated()->json('data.id');
        $this->item = Product::withoutTenancy()->findOrFail($id);
    }

    // ── The way back ────────────────────────────────────────────────

    public function test_a_day_closed_by_mistake_is_opened_again_and_sold_in(): void
    {
        $this->openShift(1000);
        $this->sell(3);                                              // Rs 300
        $this->closeShift(1300);

        $this->at('2026-10-06 14:00');
        $day = $this->as()->getJson('/api/v1/pos/day')->assertOk()->json('data.day');
        $this->as()->postJson("/api/v1/pos/days/{$day['id']}/close", [])->assertOk()
            ->assertJsonPath('data.sales_total', '300.00');

        // The shop, at five past two: it cannot open a shift, and is told the way out.
        $this->at('2026-10-06 14:05');
        $refused = $this->as()->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'BUSINESS_DAY_CLOSED');
        $this->assertStringContainsString('Day & banking', (string) $refused->json('message'));

        // The Day screen knows what happened, and that it can be undone.
        $this->as()->getJson('/api/v1/pos/day')->assertOk()
            ->assertJsonPath('data', null)
            ->assertJsonPath('meta.closed_today.id', $day['id'])
            ->assertJsonPath('meta.closed_today.trading_date', '2026-10-06')
            ->assertJsonPath('meta.closed_today.sales_total', 300)
            ->assertJsonPath('meta.closed_today.can_reopen', true);

        $this->as()->postJson("/api/v1/pos/days/{$day['id']}/reopen", ['reason' => 'Closed it by mistake'])
            ->assertOk()
            ->assertJsonPath('data.status', 'open')
            ->assertJsonPath('data.closed_at', null)
            ->assertJsonPath('data.reopen_reason', 'Closed it by mistake')
            ->assertJsonPath('data.reopened_by.id', $this->owner->id)
            // An open day has no roll-up. The 300 it was signed off at is on
            // the trail; left here it would be a day total that stops at two.
            ->assertJsonPath('data.sales_total', '0.00')
            ->assertJsonPath('data.shifts_count', 0);

        // And the afternoon goes on — in the SAME day.
        $this->openShift(500);
        $this->sell(2);                                              // Rs 200
        $this->assertSame(1, BusinessDay::withoutTenancy()->where('tenant_id', $this->shop->id)->count());
        $this->as()->getJson('/api/v1/pos/day')->assertOk()
            ->assertJsonPath('data.day.id', $day['id'])
            ->assertJsonPath('meta.closed_today', null);

        // Closed properly at ten, it is the WHOLE day: both shifts.
        $this->at('2026-10-06 22:00');
        $this->closeShift(700);
        $this->as()->postJson("/api/v1/pos/days/{$day['id']}/close", [])->assertOk()
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.shifts_count', 2)
            ->assertJsonPath('data.sales_count', 2)
            ->assertJsonPath('data.sales_total', '500.00')
            // Who opened it again stays on the day after it is closed.
            ->assertJsonPath('data.reopen_reason', 'Closed it by mistake');
    }

    public function test_the_trail_says_who_undid_the_sign_off_and_what_it_had_said(): void
    {
        $day = $this->aDayClosedAt('2026-10-06 14:00', takings: 3);
        $before = AuditLog::query()->where('tenant_id', $this->shop->id)->count();

        $this->at('2026-10-06 14:05');
        $this->as()->postJson("/api/v1/pos/days/{$day}/reopen", ['reason' => '  Wrong button  '])->assertOk();

        // ONE line. The model's own "changed" row would be a second, listing
        // fifteen columns going to zero.
        $rows = AuditLog::query()->where('tenant_id', $this->shop->id)->latest('id')->get();
        $this->assertCount($before + 1, $rows);

        $row = $rows->firstWhere('event', 'reopened');
        $this->assertNotNull($row);
        $this->assertSame(BusinessDay::class, $row->auditable_type);
        $this->assertSame($day, $row->auditable_id);
        $this->assertSame($this->owner->id, $row->user_id);
        $this->assertSame('Wrong button', $row->new_values['reason']);
        $this->assertSame('2026-10-06', $row->new_values['trading_date']);
        // What it had been signed off at, kept — the day itself no longer says.
        $this->assertEquals(300.0, $row->old_values['sales_total']);
        $this->assertEquals(1300.0, $row->old_values['counted_cash']);
        $this->assertSame(1, $row->old_values['shifts_count']);
        $this->assertNotNull($row->old_values['closed_at']);
    }

    public function test_a_reason_is_not_optional(): void
    {
        $day = $this->aDayClosedAt('2026-10-06 14:00');

        foreach ([[], ['reason' => ''], ['reason' => 'ok'], ['reason' => str_repeat('x', 256)]] as $payload) {
            $this->as()->postJson("/api/v1/pos/days/{$day}/reopen", $payload)
                ->assertStatus(422)->assertJsonStructure(['errors' => ['reason']]);
        }

        $this->assertSame('closed', BusinessDay::withoutTenancy()->find($day)->status);
    }

    public function test_only_somebody_who_may_close_the_day_may_open_it_again(): void
    {
        $day = $this->aDayClosedAt('2026-10-06 14:00');
        $cashier = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();
        $manager = User::factory()->tenantStaff($this->shop, ['sales.manage', 'reports.view'])->create();

        $this->as($cashier)->postJson("/api/v1/pos/days/{$day}/reopen", ['reason' => 'Let me sell'])->assertForbidden();
        // …and the cashier is not offered a button that would refuse them.
        $this->as($cashier)->getJson('/api/v1/pos/day')->assertOk()
            ->assertJsonPath('meta.closed_today.id', $day)
            ->assertJsonPath('meta.closed_today.can_reopen', false);
        $this->assertSame('closed', BusinessDay::withoutTenancy()->find($day)->status);

        // The manager — hired to close the shop — is the one who pressed it.
        $this->as($manager)->postJson("/api/v1/pos/days/{$day}/reopen", ['reason' => 'My mistake'])->assertOk();
        $this->assertSame('open', BusinessDay::withoutTenancy()->find($day)->status);
    }

    public function test_yesterday_stays_signed_off(): void
    {
        $day = $this->aDayClosedAt('2026-10-06 22:00');

        // Next morning. Not five-past-midnight: the shop's day turns at five,
        // and until then last night IS today (the next test).
        $this->at('2026-10-07 09:00');
        $this->as()->postJson("/api/v1/pos/days/{$day}/reopen", ['reason' => 'Forgot a sale'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'BUSINESS_DAY_TOO_OLD');
        $this->as()->getJson('/api/v1/pos/day')->assertOk()->assertJsonPath('meta.closed_today', null);
        // …nor to an owner who has CHOSEN this branch, which is a different
        // question to the server (one counter, not every counter) and was
        // answered by a different line.
        $main = BusinessDay::withoutTenancy()->find($day)->branch_id;
        $this->as(branch: $main)->getJson('/api/v1/pos/day')->assertOk()->assertJsonPath('meta.closed_today', null);

        $this->assertSame('closed', BusinessDay::withoutTenancy()->find($day)->status);
        $this->assertSame('300.00', BusinessDay::withoutTenancy()->find($day)->sales_total);
    }

    public function test_past_midnight_last_night_is_still_today_and_can_be_opened_again(): void
    {
        // A restaurant closes off at ten past midnight with a table still
        // eating. By its own clock this is still the 6th.
        $day = $this->aDayClosedAt('2026-10-07 00:10');

        $this->at('2026-10-07 00:20');
        $this->as()->getJson('/api/v1/pos/day')->assertOk()->assertJsonPath('meta.closed_today.id', $day);
        $this->as()->postJson("/api/v1/pos/days/{$day}/reopen", ['reason' => 'Table 4 still eating'])->assertOk();
    }

    public function test_once_trading_has_moved_on_the_old_day_stays_closed(): void
    {
        // The forecourt: closed off at ten to midnight, selling again at half
        // past. That is a NEW day, and the old one is behind it.
        $evening = $this->aDayClosedAt('2026-10-06 23:50');

        $this->at('2026-10-07 00:30');
        $this->openShift(500);

        $this->as()->postJson("/api/v1/pos/days/{$evening}/reopen", ['reason' => 'Changed my mind'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'BUSINESS_DAY_MOVED_ON');
        $this->assertSame('closed', BusinessDay::withoutTenancy()->find($evening)->status);
    }

    public function test_an_open_day_is_not_reopened(): void
    {
        $this->openShift(1000);
        $day = $this->as()->getJson('/api/v1/pos/day')->json('data.day.id');

        $this->as()->postJson("/api/v1/pos/days/{$day}/reopen", ['reason' => 'Just checking'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'BUSINESS_DAY_OPEN');
        $this->assertNull(BusinessDay::withoutTenancy()->find($day)->reopened_at);

        // And it is never OFFERED: the question the screen asks before it
        // draws the button gives the same answer the button would.
        $branch = BusinessDay::withoutTenancy()->find($day)->branch_id;
        app(TenantContext::class)->set($this->shop);
        $this->assertNull(ReopenBusinessDayAction::candidate($branch, $this->owner));
    }

    public function test_each_counter_answers_for_its_own_day(): void
    {
        // Gulberg closed off at two by mistake. Main has not opened yet.
        $gulberg = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);
        $main = Branch::withoutTenancy()->where('tenant_id', $this->shop->id)->where('is_default', true)->value('id');
        $this->assertNotNull($main);

        $this->openShift(500, $gulberg->id);
        $this->closeShift(500, $gulberg->id);
        $this->at('2026-10-06 14:00');
        $closed = BusinessDay::withoutTenancy()->where('branch_id', $gulberg->id)->firstOrFail();
        $this->as(branch: $gulberg->id)->postJson("/api/v1/pos/days/{$closed->id}/close", [])->assertOk();

        // An owner looking AT MAIN is not shown Gulberg's closed day as if it
        // were Main's — reopening it from here would open a counter they are
        // not looking at.
        $this->as(branch: $main)->getJson('/api/v1/pos/day')->assertOk()->assertJsonPath('meta.closed_today', null);
        // Looking at Gulberg, or at every branch, they are.
        $this->as(branch: $gulberg->id)->getJson('/api/v1/pos/day')->assertOk()
            ->assertJsonPath('meta.closed_today.id', $closed->id)
            ->assertJsonPath('meta.closed_today.branch', 'Gulberg');
        $this->as()->getJson('/api/v1/pos/day')->assertOk()->assertJsonPath('meta.closed_today.id', $closed->id);

        // Main trades on — into TOMORROW's small hours, a later day at
        // another counter. That says nothing about Gulberg's.
        $this->at('2026-10-06 23:50');
        $this->openShift(1000, $main);
        $this->closeShift(1000, $main);
        $mainDay = BusinessDay::withoutTenancy()->where('branch_id', $main)->firstOrFail();
        $this->as(branch: $main)->postJson("/api/v1/pos/days/{$mainDay->id}/close", [])->assertOk();
        $this->at('2026-10-07 00:30');
        $this->openShift(1000, $main);
        $this->assertSame(2, BusinessDay::withoutTenancy()->where('branch_id', $main)->count());

        $this->as(branch: $gulberg->id)->postJson("/api/v1/pos/days/{$closed->id}/reopen", ['reason' => 'Closed too early'])
            ->assertOk()->assertJsonPath('data.status', 'open');
    }

    public function test_another_shop_cannot_open_this_ones_day(): void
    {
        $day = $this->aDayClosedAt('2026-10-06 14:00');

        $other = Tenant::factory()->create([
            'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'), 'setup_completed' => true,
        ]);
        $stranger = User::factory()->shopOwner($other)->create();

        $this->as($stranger)->postJson("/api/v1/pos/days/{$day}/reopen", ['reason' => 'Not mine'])->assertNotFound();
        $this->assertSame('closed', BusinessDay::withoutTenancy()->find($day)->status);
    }

    // ── Which day a counter is trading ──────────────────────────────

    public function test_a_shop_that_closes_at_midnight_and_keeps_selling_starts_a_new_day(): void
    {
        $evening = $this->aDayClosedAt('2026-10-06 23:50');

        // Half past midnight. The shop's own day has not turned (five), but
        // the 6th was counted and signed — what is rung now is the 7th's.
        $this->at('2026-10-07 00:30');
        $this->openShift(500);
        $this->sell(1);

        $days = BusinessDay::withoutTenancy()->where('tenant_id', $this->shop->id)->orderBy('trading_date')->get();
        $this->assertSame(['2026-10-06', '2026-10-07'], $days->map(fn ($d) => $d->trading_date->toDateString())->all());
        $this->assertSame(['closed', 'open'], $days->pluck('status')->all());
        $this->assertSame('300.00', $days[0]->sales_total, 'The signed-off day must not move.');

        // The dashboard sees a day being traded — not "nobody has opened the
        // till", which is what a day dated ahead of the shop's own looked like.
        $till = $this->as()->getJson('/api/v1/dashboard')->assertOk()->json('data.till');
        $this->assertTrue($till['day_open']);
        $this->assertSame($days[1]->id, $till['day_id']);
        $this->assertSame(1, $till['open_shifts']);
        $this->assertSame(0, $till['unclosed_days']);

        $this->assertNotSame($evening, $days[1]->id);
    }

    public function test_another_branchs_close_does_not_start_a_new_day_here(): void
    {
        // Gulberg signed off at half past eleven. Saddar (Main) is serving
        // until two — and its one o'clock shift belongs to the evening it
        // opened in, whatever Gulberg did.
        $gulberg = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);

        $this->at('2026-10-06 18:00');
        // Gulberg first: it is the row a careless query would find first.
        $this->openShift(500, $gulberg->id);
        $this->at('2026-10-06 23:30');
        $this->closeShift(500, $gulberg->id);
        $gulbergDay = BusinessDay::withoutTenancy()->where('branch_id', $gulberg->id)->firstOrFail();
        $this->as(branch: $gulberg->id)->postJson("/api/v1/pos/days/{$gulbergDay->id}/close", [])->assertOk();

        $this->at('2026-10-06 23:40');
        $this->openShift(1000);
        $this->at('2026-10-07 00:50');
        $this->closeShift(1000);

        $this->at('2026-10-07 01:00');
        $this->openShift(1000);

        $main = BusinessDay::withoutTenancy()
            ->where('tenant_id', $this->shop->id)->where('branch_id', '!=', $gulberg->id)->get();
        $this->assertSame(['2026-10-06'], $main->map(fn ($d) => $d->trading_date->toDateString())->all());
        $this->assertSame('open', $main[0]->status);
    }

    // ── Plumbing ────────────────────────────────────────────────────

    private function at(string $wall): void
    {
        $this->travelTo(Carbon::parse($wall, 'Asia/Karachi'));
    }

    /** A day with one counted shift in it, closed off at this moment on the shop's wall. */
    private function aDayClosedAt(string $wall, int $takings = 3): string
    {
        $this->openShift(1000);
        $this->sell($takings);
        $this->closeShift(1000 + $takings * 100);

        $this->at($wall);
        $day = $this->as()->getJson('/api/v1/pos/day')->assertOk()->json('data.day.id');
        $this->as()->postJson("/api/v1/pos/days/{$day}/close", [])->assertOk();

        return $day;
    }

    private function openShift(float $float, ?string $branch = null): void
    {
        $this->as(branch: $branch)->postJson('/api/v1/pos/session/open', ['opening_float' => $float])->assertCreated();
    }

    private function closeShift(float $counted, ?string $branch = null): void
    {
        $this->as(branch: $branch)->postJson('/api/v1/pos/session/close', ['counted_cash' => $counted])->assertOk();
    }

    private function sell(int $qty): TestResponse
    {
        return $this->as()->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $this->item->id, 'quantity' => $qty]],
            'payment_method' => 'cash',
            'amount_paid' => $qty * 100,
        ])->assertCreated();
    }

    private function as(?User $user = null, ?string $branch = null): static
    {
        // A token lives an hour, and these days are longer than that.
        $this->defaultHeaders = [];
        $token = ($user ?? $this->owner)->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        $this->withToken($token);

        return $branch === null ? $this : $this->withHeaders(['X-Branch-Id' => $branch]);
    }
}
