<?php

namespace Tests\Feature;

use App\Actions\Demo\CreateDemoShopAction;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Database\Seeders\CitySeeder;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * "TRY THE DEMO" — a working shop of your own, for a day.
 *
 * A shared sandbox is renamed to nonsense inside a day and two visitors ringing
 * sales at once ruin each other's figures, so each visitor gets their own
 * tenant. That means strangers writing real rows into the real database, and
 * every test here is about a fence that keeps that safe rather than about the
 * feature being pleasant.
 */
class DemoShopTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(CitySeeder::class);
        $this->seed(PlanSeeder::class);
    }

    // ── It hands over something that works ──────────────────────────

    public function test_it_opens_a_stocked_shop_and_signs_you_straight_into_it(): void
    {
        $res = $this->postJson('/api/v1/demo', ['business_type' => 'food'])->assertCreated();

        $this->assertNotEmpty($res->json('data.access_token'), 'no token — the visitor would land on a sign-in form');

        $tenant = Tenant::query()->where('is_demo', true)->firstOrFail();
        $this->assertSame('food', $tenant->business_type);
        $this->assertTrue($tenant->setup_completed, 'a visitor who came to see a till must not meet the setup wizard');
    }

    public function test_the_shelf_is_stocked_where_the_till_actually_looks(): void
    {
        // `stock_quantity` is a rollup; the till sells from `branch_stock`. A
        // demo whose every item reads "out of stock" demonstrates the opposite
        // of the thing it exists to demonstrate.
        $this->postJson('/api/v1/demo', ['business_type' => 'mart'])->assertCreated();

        $tenant = Tenant::query()->where('is_demo', true)->firstOrFail();
        $product = Product::withoutTenancy()->where('tenant_id', $tenant->id)->firstOrFail();

        $this->assertGreaterThan(0, (float) $product->stock_quantity, 'nothing on the shelf');
        $this->assertDatabaseHas('branch_stock', [
            'tenant_id' => $tenant->id, 'product_id' => $product->id,
        ]);
    }

    public function test_every_trade_can_open_one(): void
    {
        // The picker on the landing page offers all of them. A trade that 500s
        // here is a dead button on the page the product is sold from.
        foreach (BusinessTypes::codes() as $code) {
            $this->postJson('/api/v1/demo', ['business_type' => $code])
                ->assertCreated();
        }
    }

    public function test_it_refuses_a_trade_that_does_not_exist(): void
    {
        $this->postJson('/api/v1/demo', ['business_type' => 'casino'])->assertStatus(422);
        $this->assertSame(0, Tenant::query()->where('is_demo', true)->count());
    }

    // ── And the fences ──────────────────────────────────────────────

    public function test_a_demo_shop_never_appears_in_the_marketplace(): void
    {
        // The one that would actually hurt somebody: a customer ordering
        // dinner from a shop that will not exist tomorrow.
        $this->postJson('/api/v1/demo', ['business_type' => 'food'])->assertCreated();
        $demo = Tenant::query()->where('is_demo', true)->firstOrFail();
        // Give it everything else a shop needs to be listed, so the ONLY thing
        // keeping it out is the demo flag.
        $demo->forceFill(['online_shop_enabled' => true, 'status' => 'active'])->save();

        $visible = Tenant::query()->marketplaceVisible()->pluck('id');

        $this->assertNotContains($demo->id, $visible->all(),
            'a demo shop was listed for customers to order from');
    }

    public function test_the_owner_password_is_never_one_anybody_could_guess(): void
    {
        // A demo is entered by the token and by nothing else. If a password
        // were set to something known, an abandoned shop could be signed back
        // into after the next visitor was handed one.
        $this->postJson('/api/v1/demo', ['business_type' => 'retail'])->assertCreated();
        $owner = User::query()->whereNotNull('tenant_id')->latest('id')->firstOrFail();

        foreach (['password', 'demo', 'demo1234', '12345678'] as $guess) {
            $this->assertFalse(Hash::check($guess, $owner->password));
        }
    }

    public function test_it_ends_a_day_from_now_and_says_when(): void
    {
        $res = $this->postJson('/api/v1/demo', ['business_type' => 'food'])->assertCreated();

        $tenant = Tenant::query()->where('is_demo', true)->firstOrFail();
        $this->assertEqualsWithDelta(
            CreateDemoShopAction::HOURS,
            now()->diffInHours($tenant->demo_expires_at, false),
            1,
        );
        // The banner prints this. "Expires soon" is not a sentence a shop can act on.
        $this->assertNotNull($res->json('data.demo.expires_at'));
    }

    public function test_the_shop_tells_the_panel_it_is_a_demo(): void
    {
        // Without these two the banner cannot be drawn, and a demo that looks
        // like a real shop is one somebody types real products into before
        // discovering it disappears.
        $res = $this->postJson('/api/v1/demo', ['business_type' => 'food'])->assertCreated();

        $this->assertTrue($res->json('data.user.tenant.is_demo'), 'the panel cannot tell this is a demo');
        $this->assertNotNull($res->json('data.user.tenant.demo_expires_at'), 'the banner has no time to print');
    }

    // ── The promise the software has to keep ────────────────────────

    public function test_the_prune_actually_deletes_an_expired_demo(): void
    {
        // The screen promises the shop "clears itself away after a day", and a
        // scheduled command that is registered but does nothing is how this
        // codebase has already broken a promise once.
        $this->postJson('/api/v1/demo', ['business_type' => 'food'])->assertCreated();
        $demo = Tenant::query()->where('is_demo', true)->firstOrFail();
        $demo->forceFill(['demo_expires_at' => now()->subMinute()])->save();

        $this->artisan('shopos:prune-demos')->assertExitCode(0);

        $this->assertNull(Tenant::query()->find($demo->id), 'the demo shop outlived its own promise');
    }

    public function test_the_prune_leaves_a_demo_that_still_has_time(): void
    {
        $this->postJson('/api/v1/demo', ['business_type' => 'food'])->assertCreated();
        $demo = Tenant::query()->where('is_demo', true)->firstOrFail();

        $this->artisan('shopos:prune-demos')->assertExitCode(0);

        $this->assertNotNull(Tenant::query()->find($demo->id), 'it took a shop somebody was still using');
    }

    public function test_the_prune_never_touches_a_real_shop(): void
    {
        // The worst thing this command could possibly do.
        $real = Tenant::factory()->create(['setup_completed' => true]);
        $real->forceFill(['demo_expires_at' => now()->subYear()])->save();

        $this->artisan('shopos:prune-demos')->assertExitCode(0);

        $this->assertNotNull(Tenant::query()->find($real->id), 'the prune deleted a real business');
    }
}
