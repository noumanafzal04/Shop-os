<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * THE BIG PICTURE AT THE TOP OF A SHOP.
 *
 * ── What this replaces ──────────────────────────────────────────────────
 *
 * The hero read `gallery[0]`, and the gallery is gated on `feature:services`.
 * Measured against the type defaults that is food no, mart no, pharmacy no,
 * retail no — so a restaurant could not set the biggest image in the app, and
 * the answer to "where to change shop cover image?" was "you cannot, unless
 * you are a workshop".
 *
 * The gate is the thing being tested here, more than the upload: a cover that
 * only some trades can set is the bug, not the feature.
 */
class ShopCoverTest extends TestCase
{
    use RefreshDatabase;

    private function shopOf(string $type): array
    {
        $tenant = Tenant::factory()->create([
            'business_type' => $type,
            'features' => BusinessTypes::defaultFeatures($type),
            'setup_completed' => true,
            'online_shop_enabled' => true,
        ]);

        return [$tenant, User::factory()->shopOwner($tenant)->create()];
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('public');
    }

    /**
     * THE ONE THAT MATTERS. Every trade, not the two with a portfolio.
     *
     * Walked rather than sampled: a cover that works for a restaurant and not
     * for a chemist is the same bug in a smaller place, and it would reproduce
     * on one shop in four.
     */
    public function test_every_kind_of_shop_can_set_a_cover(): void
    {
        foreach (['food', 'mart', 'pharmacy', 'retail', 'services', 'automotive'] as $type) {
            [$tenant, $owner] = $this->shopOf($type);

            $this->as($owner)->post('/api/v1/shop/cover', [
                'cover' => UploadedFile::fake()->image('shopfront.jpg', 1600, 900),
            ])->assertOk();

            $path = $tenant->fresh()->cover_path;
            $this->assertNotNull($path, "a {$type} shop could not set a cover");
            $this->assertTrue(Storage::disk('public')->exists($path));
        }
    }

    /** The customer app has to be handed a URL, not a storage path. */
    public function test_the_marketplace_sends_a_url_the_app_can_load(): void
    {
        [$tenant, $owner] = $this->shopOf('food');

        $this->as($owner)->post('/api/v1/shop/cover', [
            'cover' => UploadedFile::fake()->image('shopfront.jpg', 1600, 900),
        ])->assertOk();

        $shop = $this->getJson("/api/v1/marketplace/shops/{$tenant->fresh()->slug}")
            ->assertOk()->json('data');

        $this->assertNotNull($shop['cover_url']);
        $this->assertStringContainsString($tenant->fresh()->cover_path, $shop['cover_url']);
    }

    /**
     * Replacing one deletes the old file.
     *
     * Without this every re-upload leaves its predecessor on disk for ever —
     * invisible, because the shop looks correct, and unbounded.
     */
    public function test_replacing_a_cover_does_not_leave_the_old_one_behind(): void
    {
        [$tenant, $owner] = $this->shopOf('mart');

        $this->as($owner)->post('/api/v1/shop/cover', [
            'cover' => UploadedFile::fake()->image('one.jpg'),
        ])->assertOk();
        $first = $tenant->fresh()->cover_path;

        $this->as($owner)->post('/api/v1/shop/cover', [
            'cover' => UploadedFile::fake()->image('two.jpg'),
        ])->assertOk();

        $this->assertNotSame($first, $tenant->fresh()->cover_path);
        $this->assertFalse(Storage::disk('public')->exists($first));
    }

    /**
     * And it can come down again. "Replace it with nothing" is not a file a
     * browser can send, so a shop that uploaded the wrong photograph could
     * otherwise only ever swap it.
     */
    public function test_a_cover_can_be_taken_down(): void
    {
        [$tenant, $owner] = $this->shopOf('retail');

        $this->as($owner)->post('/api/v1/shop/cover', [
            'cover' => UploadedFile::fake()->image('oops.jpg'),
        ])->assertOk();
        $path = $tenant->fresh()->cover_path;

        $this->as($owner)->deleteJson('/api/v1/shop/cover')->assertOk();

        $this->assertNull($tenant->fresh()->cover_path);
        $this->assertFalse(Storage::disk('public')->exists($path));
    }

    /** Anything that is not an image, refused before it reaches the disk. */
    public function test_it_refuses_something_that_is_not_a_picture(): void
    {
        [, $owner] = $this->shopOf('food');

        $this->as($owner)->post('/api/v1/shop/cover', [
            'cover' => UploadedFile::fake()->create('menu.pdf', 40, 'application/pdf'),
        ])->assertStatus(422);
    }

    /**
     * The cover is bigger than the logo on purpose — it fills the widest band
     * in the app, and a photograph of a counter at that size routinely leaves
     * a modern camera above the logo's 2 MB. A limit that refuses the ordinary
     * case teaches a shopkeeper the feature is broken.
     */
    public function test_a_normal_photograph_is_not_refused_for_being_too_large(): void
    {
        [, $owner] = $this->shopOf('food');

        $this->as($owner)->post('/api/v1/shop/cover', [
            'cover' => UploadedFile::fake()->create('counter.jpg', 3000, 'image/jpeg'),
        ])->assertOk();
    }

    public function test_a_shopkeeper_without_settings_cannot_change_how_the_shop_looks(): void
    {
        [$tenant] = $this->shopOf('food');
        $staff = User::factory()->tenantStaff($tenant, ['sales.manage'])->create();

        $this->as($staff)->post('/api/v1/shop/cover', [
            'cover' => UploadedFile::fake()->image('x.jpg'),
        ])->assertForbidden();
    }
}
