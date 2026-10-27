<?php

namespace Tests\Feature;

use App\Actions\Shop\ApplyBusinessTypeDefaultsAction;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * SERVICES #S1: A SALON OPENS ABLE TO SAY WHO SERVED.
 *
 * One shop-wide "ask who served: off" is right for a kiryana and backwards
 * for a salon, where who did the work is the business. A trade now starts
 * with its own settings — once, never over a choice somebody made.
 */
class ATradeStartsWithItsOwnSettingsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(PlanSeeder::class);
    }

    public function test_a_salon_asks_who_served_and_takes_tips_from_its_first_day(): void
    {
        $salon = $this->create('QA Salon', 'services');

        $this->assertTrue((bool) $salon->setting('pos_ask_who_served'));
        $this->assertTrue((bool) $salon->setting('tips_enabled'));
    }

    public function test_a_kiryana_keeps_the_shop_wide_default(): void
    {
        $mart = $this->create('QA Kiryana', 'mart');

        $this->assertFalse((bool) $mart->setting('pos_ask_who_served'));
        $this->assertFalse((bool) $mart->setting('tips_enabled'));
    }

    public function test_a_choice_already_made_is_never_overwritten(): void
    {
        $salon = Tenant::factory()->create(['settings' => ['pos_ask_who_served' => false]]);

        app(ApplyBusinessTypeDefaultsAction::class)->execute($salon, 'services');

        $salon->refresh();
        $this->assertFalse((bool) $salon->setting('pos_ask_who_served'), 'a shop that turned it off was turned back on');
        $this->assertTrue((bool) $salon->setting('tips_enabled'));
    }

    private function create(string $name, string $trade): Tenant
    {
        $admin = User::factory()->superAdmin()->create();
        $token = $admin->createToken('t', ['access'])->plainTextToken;

        $this->withToken($token)->postJson('/api/v1/admin/tenants', [
            'business_name' => $name, 'business_type' => $trade,
            'plan_id' => Plan::query()->where('code', 'basic')->value('id'),
            'owner' => ['name' => 'Owner', 'email' => strtolower(str_replace(' ', '', $name)).'@shop.test', 'password' => 'a-strong-password'],
        ])->assertCreated();

        return Tenant::query()->where('business_name', $name)->firstOrFail();
    }
}
