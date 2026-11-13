<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * A SHOP CAN BE FEATURED — the paid row at the top of the app's home.
 *
 * Set by whoever sells the ad space, ending on its own on the day paid for.
 * Featuring buys POSITION, never visibility: a shop a customer could not
 * order from is not shown in the paid row any more than anywhere else.
 */
class AShopCanBeFeaturedTest extends TestCase
{
    use RefreshDatabase;

    private const HERE = ['lat' => 31.5204, 'lng' => 74.3587];

    private User $admin;

    private City $city;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Cache::flush();
        $this->city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->admin = User::factory()->superAdmin()->create();
    }

    private function shop(string $name, float $dLat = 0.0, array $over = []): Tenant
    {
        $features = BusinessTypes::defaultFeatures('food');
        $features['marketplace'] = true;

        return Tenant::factory()->create([
            'business_name' => $name, 'online_shop_enabled' => true, 'setup_completed' => true,
            'business_type' => 'food', 'features' => $features, 'city_id' => $this->city->id,
            'latitude' => self::HERE['lat'] + $dLat, 'longitude' => self::HERE['lng'], ...$over,
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function feature(Tenant $shop, ?string $until, ?int $rank = null)
    {
        return $this->as($this->admin)->putJson("/api/v1/admin/tenants/{$shop->id}/feature", array_filter(
            ['until' => $until, 'rank' => $rank], fn ($v) => $v !== null,
        ) + ['until' => $until]);
    }

    /** @return list<string> */
    private function featuredRow(): array
    {
        return collect($this->getJson('/api/v1/marketplace/home?'.http_build_query(self::HERE))->assertOk()->json('data.featured'))
            ->pluck('business_name')->all();
    }

    public function test_a_featured_shop_heads_the_home_in_the_admins_order_and_says_so_on_its_card(): void
    {
        $karahi = $this->shop('Karahi House', 0.010);
        $burger = $this->shop('Burger Lab', 0.001);
        $this->shop('Plain Bakery', 0.002);

        $this->feature($karahi, now()->addDays(7)->toDateTimeString(), 1)->assertOk()->assertJsonPath('data.is_featured', true);
        $this->feature($burger, now()->addDays(7)->toDateTimeString(), 2)->assertOk();

        // Ranked, not nearest: the admin sold the first place to Karahi House.
        $this->assertSame(['Karahi House', 'Burger Lab'], $this->featuredRow());

        $nearby = collect($this->getJson('/api/v1/marketplace/home?'.http_build_query(self::HERE))->json('data.nearby'))
            ->pluck('is_featured', 'business_name')->all();
        $this->assertSame(['Burger Lab' => true, 'Plain Bakery' => false, 'Karahi House' => true], $nearby, 'the card says Featured wherever it appears');
    }

    public function test_the_rows_see_all_lists_only_todays_featured_shops_in_the_admins_order(): void
    {
        $karahi = $this->shop('Karahi House', 0.010);
        $burger = $this->shop('Burger Lab', 0.001);
        $lapsed = $this->shop('Lapsed Grill', 0.002);
        $this->shop('Plain Bakery', 0.003);
        $this->feature($karahi, now()->addDays(7)->toDateTimeString(), 1)->assertOk();
        $this->feature($burger, now()->addDays(7)->toDateTimeString(), 2)->assertOk();
        $this->feature($lapsed, now()->addDay()->toDateTimeString(), 3)->assertOk();
        $this->travel(2)->days();

        $listed = collect($this->getJson('/api/v1/marketplace/shops?'.http_build_query(self::HERE + ['featured' => 1]))
            ->assertOk()->json('data'))->pluck('business_name')->all();

        // Ranked, not nearest — and the shop whose paid days ran out is gone.
        $this->assertSame(['Karahi House', 'Burger Lab'], $listed);
        $this->assertCount(4, $this->getJson('/api/v1/marketplace/shops?'.http_build_query(self::HERE))->json('data'), 'without the flag, every shop');
    }

    public function test_the_paid_days_end_on_their_own_and_a_cleared_date_ends_them_now(): void
    {
        $shop = $this->shop('Karahi House');
        $this->feature($shop, now()->addDays(3)->toDateTimeString())->assertOk();
        $this->assertSame(['Karahi House'], $this->featuredRow());

        $this->travel(4)->days();
        $this->assertSame([], $this->featuredRow(), 'the paid days ran out');

        $this->travelBack();
        $this->feature($shop, now()->addDays(3)->toDateTimeString())->assertOk();
        $this->feature($shop, null)->assertOk()->assertJsonPath('data.is_featured', false);
        $this->assertSame([], $this->featuredRow());
    }

    public function test_featuring_buys_position_not_visibility(): void
    {
        $closed = $this->shop('Closed Kitchen', 0.0, ['online_shop_enabled' => false]);
        $far = $this->shop('Far Away Foods', 0.9); // ~100 km: outside the city-wide fallback radius
        $this->feature($closed, now()->addDays(7)->toDateTimeString())->assertOk();
        $this->feature($far, now()->addDays(7)->toDateTimeString())->assertOk();

        $this->assertSame([], $this->featuredRow());
    }

    public function test_only_whoever_sells_the_ad_space_may_feature_and_the_end_is_in_the_future(): void
    {
        $shop = $this->shop('Karahi House');
        $support = User::factory()->adminStaff([Permissions::TENANTS_VIEW, Permissions::TENANTS_UPDATE])->create();
        $this->as($support)->putJson("/api/v1/admin/tenants/{$shop->id}/feature", ['until' => now()->addDay()->toDateTimeString()])->assertForbidden();

        $ads = User::factory()->adminStaff([Permissions::BANNERS_MANAGE])->create();
        $this->as($ads)->putJson("/api/v1/admin/tenants/{$shop->id}/feature", ['until' => now()->subDay()->toDateTimeString()])
            ->assertUnprocessable()->assertJsonValidationErrors('until');
        $this->as($ads)->putJson("/api/v1/admin/tenants/{$shop->id}/feature", ['until' => now()->addDays(30)->toDateTimeString(), 'rank' => 5])->assertOk();

        $this->assertSame(5, $shop->fresh()->featured_rank);
        $this->assertTrue($shop->fresh()->isFeatured());
    }
}
