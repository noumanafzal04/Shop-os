<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Models\Product;
use App\Models\ShopRequest;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Database\Seeders\CitySeeder;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * "KEEP THIS SHOP" — a demo asking to become a business.
 *
 * The visitor has put their own products into that tenant and probably rung a
 * sale on it. So this is a request to CONVERT what they built, and every test
 * here is about not losing it: not to a prune while they wait, not to an admin
 * who is slow, and not to a fresh empty tenant handed over in its place.
 */
class KeepThisShopTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(CitySeeder::class);
        $this->seed(PlanSeeder::class);
    }

    /** @return array{0: Tenant, 1: User} */
    private function aDemo(): array
    {
        $this->postJson('/api/v1/demo', ['business_type' => 'mart'])->assertCreated();
        // LATEST, not first. Taking `first()` handed the second call the
        // first shop's owner back, so a test about two waiting shops was
        // quietly about one.
        $tenant = Tenant::query()->where('is_demo', true)->latest('id')->firstOrFail();

        return [$tenant, $tenant->users()->firstOrFail()];
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function ask(User $owner, array $over = []): TestResponse
    {
        return $this->actingAsUser($owner)->postJson('/api/v1/shop/keep', array_merge([
            'contact_name' => 'Bilal Ahmed',
            'contact_email' => 'bilal@example.com',
            'contact_phone' => '03001234567',
            'password' => 'my-own-password-9',
            'note' => 'Two branches later maybe.',
        ], $over));
    }

    // ── Asking ──────────────────────────────────────────────────────

    public function test_asking_gives_the_owner_a_sign_in_they_did_not_have(): void
    {
        // The gap this closes: a demo owner could not sign in AT ALL. The
        // account was opened with a throwaway address and a random password
        // nobody was told, so closing the tab lost them the shop before its own
        // clock ran out.
        [, $owner] = $this->aDemo();
        $this->assertFalse(Hash::check('my-own-password-9', $owner->password));

        $this->ask($owner)->assertCreated();

        $owner->refresh();
        $this->assertSame('bilal@example.com', $owner->email);
        $this->assertTrue(Hash::check('my-own-password-9', $owner->password),
            'they still cannot get back into the shop they asked to keep');
    }

    public function test_the_request_reaches_the_admin_with_a_way_to_reply(): void
    {
        [$tenant, $owner] = $this->aDemo();
        $this->ask($owner)->assertCreated();

        $this->assertDatabaseHas('shop_requests', [
            'tenant_id' => $tenant->id,
            'contact_email' => 'bilal@example.com',
            'status' => ShopRequest::PENDING,
        ]);
    }

    public function test_pressing_twice_does_not_make_two_requests(): void
    {
        // Somebody being unsure is not a second business, and two rows would
        // give the admin two things to answer about one shop.
        [$tenant, $owner] = $this->aDemo();
        $this->ask($owner)->assertCreated();
        $this->ask($owner, ['contact_email' => 'bilal@example.com'])->assertOk();

        $this->assertSame(1, ShopRequest::query()->where('tenant_id', $tenant->id)->count());
    }

    public function test_a_phone_number_is_genuinely_optional(): void
    {
        // It is validated as nullable and the code read it as though it were
        // always there — so leaving it out, which the form allows, was a 500.
        // Every other test sent one, which is exactly why nothing said so.
        [, $owner] = $this->aDemo();

        $this->actingAsUser($owner)->postJson('/api/v1/shop/keep', [
            'contact_name' => 'Bilal Ahmed',
            'contact_email' => 'bilal@example.com',
            'password' => 'my-own-password-9',
        ])->assertCreated();
    }

    public function test_a_real_shop_cannot_ask_to_be_kept(): void
    {
        $tenant = Tenant::factory()->create(['setup_completed' => true]);
        $owner = User::factory()->shopOwner($tenant)->create();

        $this->ask($owner)->assertStatus(422);
    }

    public function test_an_email_already_in_use_is_refused_in_words(): void
    {
        User::factory()->create(['email' => 'taken@example.com']);
        [, $owner] = $this->aDemo();

        $this->ask($owner, ['contact_email' => 'taken@example.com'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('contact_email');
    }

    // ── The one that would quietly lose somebody's work ─────────────

    public function test_the_prune_never_takes_a_shop_somebody_is_waiting_on(): void
    {
        // Pressing "keep" is the strongest signal this product gets. Deleting
        // that person's shop because an admin has not replied yet would be the
        // worst reply available.
        [$tenant, $owner] = $this->aDemo();
        $this->ask($owner)->assertCreated();
        $tenant->forceFill(['demo_expires_at' => now()->subDay()])->save();

        $this->artisan('shopos:prune-demos')->assertExitCode(0);

        $this->assertNotNull(Tenant::query()->find($tenant->id),
            'a shop was deleted while its owner was waiting for an answer');
    }

    // ── The admin's decision ────────────────────────────────────────

    private function anAdmin(): User
    {
        return User::factory()->create([
            'role' => UserRole::AdminStaff,
            'permissions' => [Permissions::TENANTS_CREATE],
        ]);
    }

    public function test_approving_converts_the_shop_they_built(): void
    {
        // CONVERTED, never recreated: their products, their prices and the
        // sales they rang are all in this tenant.
        [$tenant, $owner] = $this->aDemo();
        $productCount = Product::withoutTenancy()->where('tenant_id', $tenant->id)->count();
        $this->ask($owner)->assertCreated();
        $req = ShopRequest::query()->firstOrFail();

        $this->actingAsUser($this->anAdmin())
            ->postJson("/api/v1/admin/shop-requests/{$req->id}/approve")
            ->assertOk();

        $tenant->refresh();
        $this->assertFalse($tenant->is_demo);
        $this->assertNull($tenant->demo_expires_at);
        $this->assertSame(
            $productCount,
            Product::withoutTenancy()->where('tenant_id', $tenant->id)->count(),
            'their catalogue was not kept',
        );
    }

    public function test_approving_sends_them_through_their_own_setup(): void
    {
        // The demo skipped setup on purpose and was handed a generated name.
        // No real business is called "Mart Demo K7QP", so the owner names their
        // own — in the one form the app already asks that question in.
        [$tenant, $owner] = $this->aDemo();
        $this->ask($owner)->assertCreated();
        $req = ShopRequest::query()->firstOrFail();

        $this->actingAsUser($this->anAdmin())
            ->postJson("/api/v1/admin/shop-requests/{$req->id}/approve")->assertOk();

        $this->assertFalse($tenant->refresh()->setup_completed,
            'they were left living with a generated shop name');
    }

    public function test_declining_needs_a_reason_and_leaves_the_shop_alone(): void
    {
        [$tenant, $owner] = $this->aDemo();
        $this->ask($owner)->assertCreated();
        $req = ShopRequest::query()->firstOrFail();
        $admin = $this->anAdmin();

        $this->actingAsUser($admin)
            ->postJson("/api/v1/admin/shop-requests/{$req->id}/decline", [])
            ->assertStatus(422);

        $this->actingAsUser($admin)
            ->postJson("/api/v1/admin/shop-requests/{$req->id}/decline", ['reason' => 'Duplicate of an existing shop.'])
            ->assertOk();

        // Still a demo, still on its own clock — not deleted out from under them.
        $this->assertTrue($tenant->refresh()->is_demo);
        $this->assertNotNull($tenant->demo_expires_at);
    }

    public function test_the_oldest_request_is_the_one_offered_first(): void
    {
        // Nothing deletes a waiting shop, so this ordering is the only thing
        // keeping a request from rotting quietly.
        [, $ownerA] = $this->aDemo();
        $this->ask($ownerA, ['contact_email' => 'a@example.com'])->assertCreated();
        ShopRequest::query()->update(['requested_at' => now()->subDays(3)]);

        [, $ownerB] = $this->aDemo();
        $this->ask($ownerB, ['contact_email' => 'b@example.com'])->assertCreated();

        $rows = $this->actingAsUser($this->anAdmin())
            ->getJson('/api/v1/admin/shop-requests')->assertOk()->json('data');

        $this->assertSame('a@example.com', $rows[0]['contact_email'],
            'the person who has waited longest was not offered first');
    }
}
