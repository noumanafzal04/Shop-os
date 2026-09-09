<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Tenant;
use App\Support\BusinessTypes;
use App\Support\Geo;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CAN THIS SHOP SERVE WHERE I AM STANDING?
 *
 * ── The two fences, and why neither was ever applied ─────────────────
 *
 * `delivery_radius_km` has been a shop setting for months. It was read in
 * exactly two places: at CHECKOUT, which refuses with `OUT_OF_DELIVERY_AREA`,
 * and on a single shop's detail payload as `delivers_to_me`. No LIST asked
 * either question — so a shopper in Karachi was shown Lahore shops sorted by
 * distance, and a shop 30 km away with a 5 km radius was listed, tapped,
 * filled with a basket, and refused at the last possible moment.
 *
 * Asked for as "location ki base py shops show hongi, hr city k lehaz sy — or
 * specific radius tk delivery hr shop ki, like foodpanda".
 *
 * This file is the scope on its own, before any endpoint uses it. Every
 * endpoint that lists shops will call the same one — the reason to insist on
 * that is `RiderService`, where one settings key read two ways (PHP defaults on
 * one side, raw JSON on the other) offered every order to nobody.
 */
class ServesPinTest extends TestCase
{
    use RefreshDatabase;

    private City $karachi;

    private City $lahore;

    /** Empress Market, Karachi. */
    private const PIN = [24.8607, 67.0011];

    protected function setUp(): void
    {
        parent::setUp();

        $this->karachi = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->lahore = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
    }

    /**
     * @param  array<string, mixed>  $settings
     */
    private function shop(string $name, ?City $city, ?float $lat, ?float $lng, array $settings = [], string $type = 'mart'): Tenant
    {
        return Tenant::factory()->create([
            'business_name' => $name,
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'city_id' => $city?->id,
            'latitude' => $lat,
            'longitude' => $lng,
            'business_type' => $type,
            'features' => BusinessTypes::defaultFeatures($type),
            'settings' => $settings,
        ]);
    }

    /**
     * @return list<string>
     */
    private function listed(?string $cityId = null): array
    {
        return Tenant::query()
            ->marketplaceVisible()
            ->servesPin(self::PIN[0], self::PIN[1], $cityId)
            ->orderBy('business_name')
            ->pluck('business_name')
            ->all();
    }

    /** A point roughly `$km` north of the pin. 1° of latitude ≈ 111 km. */
    private function northOfPin(float $km): array
    {
        return [self::PIN[0] + ($km / 111.0), self::PIN[1]];
    }

    // ── The city fence ──────────────────────────────────────────────

    public function test_a_shop_in_another_city_is_not_listed(): void
    {
        /**
         * The other city's shop is FIVE KILOMETRES from the pin.
         *
         * The first version of this test put it in Lahore, a thousand
         * kilometres away — so the distance fence dropped it and the test
         * passed with the city fence deleted. It proved nothing about cities.
         * A city is an administrative fact, not a distance: Karachi and the
         * towns around it are minutes apart, and only `city_id` can tell them
         * apart.
         */
        $this->shop('Karachi Mart', $this->karachi, ...$this->northOfPin(2));
        $this->shop('Next Town Mart', $this->lahore, ...$this->northOfPin(5));

        $this->assertSame(['Karachi Mart'], $this->listed($this->karachi->id));
    }

    public function test_an_unset_radius_means_the_shops_own_city_not_the_country(): void
    {
        /**
         * `ShopSettings` has always documented `null` as "no distance limit
         * (city-wide)" and nothing enforced the city half of that sentence.
         * With no city resolved for the shopper, distance is the only tool
         * left, so `CITY_WIDE_KM` stands in for it.
         */
        $this->shop('Near Mart', $this->karachi, ...$this->northOfPin(10));
        $this->shop('Far Mart', $this->lahore, ...$this->northOfPin(Tenant::CITY_WIDE_KM + 20));

        // No city passed at all — the fallback has to hold on its own.
        $this->assertSame(['Near Mart'], $this->listed());
    }

    // ── The shop's own radius ───────────────────────────────────────

    public function test_a_shop_that_does_not_reach_this_pin_is_not_listed(): void
    {
        $this->shop('Close Mart', $this->karachi, ...$this->northOfPin(2), ...[['delivery_radius_km' => 5]]);
        // The exact case that used to be refused at checkout instead.
        $this->shop('Small Radius Mart', $this->karachi, ...$this->northOfPin(30), ...[['delivery_radius_km' => 5]]);

        $this->assertSame(['Close Mart'], $this->listed($this->karachi->id));
    }

    public function test_the_fence_sits_where_the_shop_put_it(): void
    {
        /**
         * FIFTY METRES EITHER SIDE OF A SHOP'S OWN LINE.
         *
         * ── What this does NOT claim ─────────────────────────────────
         *
         * Not that `<=` beats `<` at a distance exactly equal to the radius.
         * That difference is one double, and it is not observable here:
         * `Geo::distanceKm` rounds to two decimals while the SQL expression
         * does not, and PHP's `atan2` haversine and SQL's `ASIN` haversine
         * disagree in their last bits. A test that claimed the boundary would
         * be testing its own arithmetic — my first version placed a shop at
         * 9.9 km with a 10 km radius and passed with `<` substituted, which is
         * exactly that mistake.
         *
         * What IS observable, and is what actually goes wrong — a wrong unit,
         * a missing COALESCE, a comparison the wrong way round — is whether
         * the fence sits anywhere near the number the shop typed. So: two
         * shops the same distance out, one whose radius covers it by 50 m and
         * one that falls 50 m short.
         */
        [$lat, $lng] = $this->northOfPin(10);
        $km = Geo::distanceKm(self::PIN[0], self::PIN[1], $lat, $lng);

        $this->shop('Just Inside', $this->karachi, $lat, $lng, ['delivery_radius_km' => $km + 0.05]);
        $this->shop('Just Outside', $this->karachi, $lat, $lng, ['delivery_radius_km' => $km - 0.05]);

        $this->assertSame(['Just Inside'], $this->listed($this->karachi->id));
    }

    public function test_a_shop_with_delivery_switched_off_is_fenced_by_the_city_instead(): void
    {
        /**
         * A counter you walk into has no radius to be inside. It earns the
         * CITY, not an exemption from distance — the first version of this rule
         * kept any shop with `pickup_enabled`, which defaults to TRUE, so
         * nearly every shop passed and the fence filtered nothing at all.
         */
        $this->shop('Pickup Corner', $this->karachi, ...$this->northOfPin(12), ...[[
            'delivery_enabled' => false,
            'delivery_radius_km' => 1,
        ]]);
        $this->shop('Pickup Far Away', $this->karachi, ...$this->northOfPin(Tenant::CITY_WIDE_KM + 10), ...[[
            'delivery_enabled' => false,
        ]]);

        $this->assertSame(['Pickup Corner'], $this->listed($this->karachi->id));
    }

    public function test_a_shop_that_never_dropped_a_pin_is_still_listed(): void
    {
        // Unmeasurable, not refused. Dropping every shop without coordinates
        // would empty the marketplace of its newest members, who are exactly
        // the ones who have not finished their profile.
        $this->shop('No Pin Mart', $this->karachi, null, null);

        $this->assertSame(['No Pin Mart'], $this->listed($this->karachi->id));
    }

    public function test_a_shop_that_never_touched_the_setting_is_not_dropped(): void
    {
        /**
         * The `RiderService` trap, in a new place: an ABSENT json key is SQL
         * NULL and compares false to everything, so a fence written without
         * COALESCE would have dropped every shop that had never opened the
         * delivery settings — which is most of them.
         */
        $this->shop('Untouched Mart', $this->karachi, ...$this->northOfPin(3), ...[[]]);

        $this->assertSame(['Untouched Mart'], $this->listed($this->karachi->id));
    }

    public function test_without_a_pin_nothing_is_fenced_by_distance(): void
    {
        // A shopper who refused location still gets a marketplace. The city is
        // whatever they picked, and distance is unknowable.
        $this->shop('Far Mart', $this->karachi, ...$this->northOfPin(200), ...[['delivery_radius_km' => 2]]);

        $names = Tenant::query()
            ->marketplaceVisible()
            ->servesPin(null, null, $this->karachi->id)
            ->pluck('business_name')
            ->all();

        $this->assertSame(['Far Mart'], $names);
    }

    // ── The same answer, in PHP, for what the card says ─────────────

    public function test_delivers_to_agrees_with_the_scope(): void
    {
        /**
         * The scope decides what is LISTED and `deliversTo` decides what the
         * card SAYS. Two answers to one question is a card promising a
         * delivery the checkout refuses — so they are asserted against each
         * other rather than each on its own.
         */
        $inside = $this->shop('Inside', $this->karachi, ...$this->northOfPin(3), ...[['delivery_radius_km' => 5]]);
        $outside = $this->shop('Outside', $this->karachi, ...$this->northOfPin(9), ...[['delivery_radius_km' => 5]]);
        $pickupOnly = $this->shop('Pickup Only', $this->karachi, ...$this->northOfPin(3), ...[['delivery_enabled' => false]]);

        $this->assertTrue($inside->deliversTo(...self::PIN));
        $this->assertFalse($outside->deliversTo(...self::PIN));
        $this->assertFalse($pickupOnly->deliversTo(...self::PIN));

        // And the listing agrees about the one that cannot reach.
        $this->assertNotContains('Outside', $this->listed($this->karachi->id));
        $this->assertContains('Inside', $this->listed($this->karachi->id));
    }

    public function test_delivers_to_is_true_when_it_cannot_be_measured(): void
    {
        // "The shop delivers, we just cannot say whether it reaches here."
        // Checkout has the last word, and it has the radius rule too.
        $shop = $this->shop('No Pin', $this->karachi, null, null);

        $this->assertTrue($shop->deliversTo(...self::PIN));
        $this->assertTrue($shop->deliversTo(null, null));
    }
}
