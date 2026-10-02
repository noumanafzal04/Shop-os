<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * THE REORDER LIST IS A WORKLIST, AND IT HAS TO SAY HOW LONG IT IS.
 *
 * It was unbounded. A load-test grocery answered with 569 rows and 685 KB —
 * every one carrying its sizes and a supplier lookup — for a screen a buyer
 * reads from the top and works down.
 *
 * Capping it is only half the job, and the half that is easy to get wrong is
 * WHICH two hundred. Ordered by id, the cap would quietly hide the shelf
 * that is actually empty behind two hundred that are merely low. Ordered by
 * quantity, the two hundred kept are the two hundred closest to out — which
 * is what a buyer opened the screen to find.
 *
 * And it must admit the cap. The stock valuation report made exactly this
 * mistake in the browser instead of the server: 100 rows drawn out of 569
 * and nothing anywhere saying the other 469 existed.
 */
class TheReorderListIsAWorklistTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @param array<int, float> $quantities one product per entry, all watched and all low */
    private function shelvesAt(array $quantities): void
    {
        $rows = [];
        foreach ($quantities as $i => $qty) {
            $rows[] = [
                'id' => (string) Str::uuid7(),
                'tenant_id' => $this->shop->id,
                'type' => 'product',
                'name' => 'Line '.str_pad((string) $i, 4, '0', STR_PAD_LEFT),
                'price' => 100,
                'cost' => 70,
                'track_inventory' => true,
                'stock_quantity' => $qty,
                // Watched: a reorder level is what puts a product on this
                // screen at all.
                'low_stock_threshold' => 1000,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        Product::withoutTenancy()->insert($rows);
    }

    public function test_a_short_list_is_sent_whole_and_says_nothing_about_a_cap(): void
    {
        $this->shelvesAt(array_fill(0, 12, 3.0));

        $body = $this->as($this->owner)->getJson('/api/v1/inventory/low-stock')->assertOk()->json();

        $this->assertCount(12, $body['data']);
        $this->assertSame(12, $body['meta']['shown']);
        $this->assertSame(12, $body['meta']['total']);
    }

    public function test_a_long_list_is_capped_and_owns_up_to_it(): void
    {
        $this->shelvesAt(array_fill(0, 260, 5.0));

        $body = $this->as($this->owner)->getJson('/api/v1/inventory/low-stock')->assertOk()->json();

        $this->assertCount(200, $body['data'], 'A buyer is given a screenful, not a database dump.');
        $this->assertSame(200, $body['meta']['shown']);
        $this->assertSame(260, $body['meta']['total'], 'And is told how many there really are.');
    }

    /**
     * THE CAP KEEPS THE RIGHT TWO HUNDRED.
     *
     * One shelf is completely empty among two hundred and fifty that are
     * merely low. It is the single most urgent row on the screen, and any
     * ordering other than "closest to out" loses it behind the cap.
     */
    public function test_the_emptiest_shelf_survives_the_cap(): void
    {
        $this->shelvesAt(array_fill(0, 250, 90.0));

        // Created LAST, so an id ordering would put it at the very bottom.
        Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => 'Sugar — out', 'price' => 200, 'cost' => 150,
            'track_inventory' => true, 'stock_quantity' => 0,
            'low_stock_threshold' => 1000, 'is_active' => true,
        ]);

        $names = collect(
            $this->as($this->owner)->getJson('/api/v1/inventory/low-stock')->assertOk()->json('data'),
        )->pluck('name');

        $this->assertTrue(
            $names->contains('Sugar — out'),
            'The one shelf that is actually empty was cut off the bottom of the list.',
        );
        $this->assertSame('Sugar — out', $names->first(), 'Emptiest first — that is the order a buyer reads.');
    }

    /**
     * THE COUNT IS NOT THE CAP.
     *
     * `watched` answers a different question — "could this screen ever show
     * anything" — and it is counted over the whole shop, not over the two
     * hundred sent. Confusing the two would tell a shop with 260 low lines
     * that it has 200.
     */
    public function test_the_watched_count_is_over_the_whole_shop(): void
    {
        $this->shelvesAt(array_fill(0, 230, 5.0));

        $meta = $this->as($this->owner)->getJson('/api/v1/inventory/low-stock')->assertOk()->json('meta');

        $this->assertSame(230, $meta['watched']);
        $this->assertSame(230, $meta['total']);
        $this->assertSame(200, $meta['shown']);
    }
}
