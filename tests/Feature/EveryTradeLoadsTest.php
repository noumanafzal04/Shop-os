<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Every shape of shop can open every screen it is offered.
 *
 * Panel-side, `shopNavReach` already proves no menu offers a dead link and no
 * screen is orphaned. Nothing was asking the other half of that question: when
 * a shop of THIS trade actually calls those endpoints, does the server answer?
 *
 * The gap is not theoretical. A type gate added to the dashboard on 2026-08-09
 * called `BusinessTypes::primary($tenant->business_type)` — correct for every
 * tenant an admin had typed, and a 500 for the ones they had not. Ten tests
 * caught it by accident. This one would have caught it on purpose, and will
 * catch the next one: a trade-specific branch runs for every tenant, including
 * the half-configured and the legacy-coded.
 *
 * All SEVENTEEN codes, not the eight canonical ones — the nine legacy codes are
 * exactly where a "is this shop a pharmacy?" branch goes wrong, because they
 * resolve rather than match.
 */
class EveryTradeLoadsTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Read-only screens an owner reaches from the menu. A module this shop
     * lacks answers 403, which is a correct answer — the assertion is only that
     * nothing here 500s.
     */
    private const SCREENS = [
        '/api/v1/dashboard',
        '/api/v1/shop',
        '/api/v1/shop/settings',
        '/api/v1/business-types',
        '/api/v1/products',
        '/api/v1/categories',
        '/api/v1/customers',
        '/api/v1/sales',
        '/api/v1/expenses',
        '/api/v1/inventory/low-stock',
        '/api/v1/products/export',
        '/api/v1/products/import/template',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    /** @return array<string, array{string}> */
    public static function tradeProvider(): array
    {
        $codes = array_keys(BusinessTypes::all());

        return array_combine(
            array_map(fn (string $c): string => "a {$c} shop", $codes),
            array_map(fn (string $c): array => [$c], $codes),
        );
    }

    #[DataProvider('tradeProvider')]
    public function test_every_screen_answers_for_this_trade(string $type): void
    {
        $shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => $type,
            'features' => BusinessTypes::defaultFeatures($type),
        ]);

        $this->assertNoScreenBreaks($shop, $type);
    }

    public function test_a_tenant_an_admin_has_not_typed_yet_still_loads(): void
    {
        // The shape that produced the 500. A tenant exists from the moment it is
        // created; its type is chosen after, and every trade branch runs in
        // between.
        $shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => null,
            'features' => BusinessTypes::defaultFeatures('retail'),
        ]);

        $this->assertNoScreenBreaks($shop, 'untyped');
    }

    public function test_a_shop_with_no_modules_at_all_still_loads(): void
    {
        // Nothing enabled: every gated branch takes its false path at once.
        $shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'retail',
            'features' => [],
        ]);

        $this->assertNoScreenBreaks($shop, 'no modules');
    }

    private function assertNoScreenBreaks(Tenant $shop, string $label): void
    {
        $owner = User::factory()->shopOwner($shop)->create();
        $token = $owner->createToken('t', ['access'])->plainTextToken;

        foreach (self::SCREENS as $screen) {
            $this->app['auth']->forgetGuards();
            $status = $this->withToken($token)->get($screen)->getStatusCode();

            $this->assertLessThan(
                500,
                $status,
                "{$label}: GET {$screen} answered {$status} — a trade branch broke for this shop.",
            );
        }
    }
}
