<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Promotion;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\OfferWindow;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * AN OFFER THAT STARTS TODAY RUNS TODAY.
 *
 * Codex QA, 2026-10-16 (BUG-69): a 10% promotion and a bank card offer, both
 * dated 16 Oct → 16 Oct, gave nothing on the 16th in a Karachi shop, and
 * worked the moment their start was moved to the 15th. `starts_on` is a box
 * date that arrives as midnight UTC; the shop's "today" was compared with it as
 * a moment, and the shop's 16th begins at 19:00 UTC on the 15th.
 */
class AnOfferStartingTodayRunsTodayTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'retail', 'timezone' => 'Asia/Karachi',
            'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        Promotion::query()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Today only', 'is_active' => true,
            'type' => 'percent', 'value' => 10, 'scope' => 'order', 'priority' => 0,
            'starts_on' => '2026-10-16', 'ends_on' => '2026-10-16',
        ]);
    }

    private function discountAt(string $utc): float
    {
        $this->travelTo(Carbon::parse($utc, 'UTC'));
        $lawn = Product::query()->firstOrCreate(['tenant_id' => $this->shop->id, 'name' => 'Lawn suit'], [
            'type' => 'product', 'item_type' => 'physical_product', 'price' => 1000, 'tax_rate' => 0,
            'track_inventory' => false, 'is_active' => true,
        ]);
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return (float) $this->withToken($token)
            ->postJson('/api/v1/promotions/preview', ['items' => [['product_id' => $lawn->id, 'quantity' => 1]]])
            ->assertOk()->json('data.discount');
    }

    public function test_the_first_day_and_the_last_are_both_inside(): void
    {
        // 11:00 on the 16th in Karachi.
        $this->assertEqualsWithDelta(100.0, $this->discountAt('2026-10-16 06:00:00'), 0.001,
            'an offer dated today gave nothing today');
        // 23:30 on the 16th in Karachi (18:30 UTC).
        $this->assertEqualsWithDelta(100.0, $this->discountAt('2026-10-16 18:30:00'), 0.001);
    }

    public function test_the_day_before_and_the_day_after_are_outside(): void
    {
        // 23:00 on the 15th in Karachi.
        $this->assertEqualsWithDelta(0.0, $this->discountAt('2026-10-15 18:00:00'), 0.001, 'it ran the evening before');
        // 10:00 on the 17th in Karachi.
        $this->assertEqualsWithDelta(0.0, $this->discountAt('2026-10-17 05:00:00'), 0.001, 'it ran the day after');
    }

    public function test_the_one_rule_judges_the_shops_calendar_day_for_every_offer(): void
    {
        // The bank's card offer asks the same rule (BankOfferService::liveNow).
        $day = Carbon::parse('2026-10-16'); // a box date, as the `date` cast gives it
        $at = fn (string $local) => Carbon::parse($local, 'Asia/Karachi');

        $this->assertTrue(OfferWindow::isLive($at('2026-10-16 00:30:00'), $day, $day, null, null, null), 'the first half hour of the day');
        $this->assertTrue(OfferWindow::isLive($at('2026-10-16 23:59:00'), $day, $day, null, null, null), 'the last minute of the day');
        $this->assertFalse(OfferWindow::isLive($at('2026-10-15 23:59:00'), $day, $day, null, null, null));
        $this->assertFalse(OfferWindow::isLive($at('2026-10-17 00:00:00'), $day, $day, null, null, null));
    }
}
