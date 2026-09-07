<?php

namespace Tests\Feature;

use App\Models\Banner;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class BannerTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Tenant $shop;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->admin = User::factory()->superAdmin()->create();
        $this->shop = Tenant::factory()->create(['business_name' => 'Cheezy', 'slug' => 'cheezy']);
    }

    private function asAdmin(): static
    {
        $this->app['auth']->forgetGuards();

        return $this->actingAs($this->admin);
    }

    public function test_admin_creates_a_shop_banner(): void
    {
        Storage::fake('public');

        $banner = $this->asAdmin()->post('/api/v1/admin/banners', [
            'image' => UploadedFile::fake()->image('promo.jpg', 1200, 600),
            'title' => 'Eid Sale', 'target_type' => 'shop', 'tenant_id' => $this->shop->id,
            'amount' => 5000, 'paid_at' => now()->toDateString(),
        ])->assertCreated()->json('data');

        $this->assertSame('Eid Sale', $banner['title']);
        Storage::disk('public')->assertExists($banner['image_path']);
        $this->assertEquals(5000, $banner['amount']);
    }

    public function test_shop_banner_requires_advertiser(): void
    {
        Storage::fake('public');
        $this->asAdmin()->post('/api/v1/admin/banners', [
            'image' => UploadedFile::fake()->image('x.jpg', 1200, 600), 'target_type' => 'shop',
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['tenant_id']]);
    }

    public function test_public_feed_returns_live_banners_with_target(): void
    {
        Banner::query()->create([
            'tenant_id' => $this->shop->id, 'image_path' => 'banners/a.jpg',
            'target_type' => 'shop', 'placement' => 'home', 'is_active' => true, 'sort_order' => 0,
        ]);
        // Scheduled for the future → not live.
        Banner::query()->create([
            'tenant_id' => $this->shop->id, 'image_path' => 'banners/b.jpg',
            'target_type' => 'shop', 'placement' => 'home', 'is_active' => true, 'starts_at' => now()->addWeek(),
        ]);
        // Inactive.
        Banner::query()->create(['image_path' => 'banners/c.jpg', 'target_type' => 'none', 'placement' => 'home', 'is_active' => false]);

        $customer = User::factory()->create();
        $this->app['auth']->forgetGuards();
        $data = $this->actingAs($customer)->getJson('/api/v1/marketplace/banners?placement=home')->assertOk()->json('data');

        $this->assertCount(1, $data);
        $this->assertSame('shop', $data[0]['target']['type']);
        $this->assertSame('cheezy', $data[0]['target']['shop_slug']);
        $this->assertNotNull($data[0]['image_url']);
    }

    public function test_click_increments_count_and_returns_target(): void
    {
        $banner = Banner::query()->create([
            'tenant_id' => $this->shop->id, 'image_path' => 'banners/a.jpg',
            'target_type' => 'shop', 'placement' => 'home', 'is_active' => true,
        ]);

        $customer = User::factory()->create();
        $this->app['auth']->forgetGuards();
        $this->actingAs($customer)->postJson("/api/v1/marketplace/banners/{$banner->id}/click")
            ->assertOk()->assertJsonPath('data.target.shop_slug', 'cheezy');

        $this->assertSame(1, $banner->fresh()->click_count);
    }

    public function test_a_banner_created_without_a_target_type_is_a_shop_banner_and_is_held_to_it(): void
    {
        // Optional in the rules, always sent by the form. The branch nobody had
        // driven down: what a banner with no target_type is. The column says
        // `shop`, so the request has to hold this one to a shop banner's rule —
        // if the two disagreed, a banner would be stored pointing at a shop it
        // never named and the aisle would render a card that goes nowhere.
        Storage::fake('public');

        $this->asAdmin()->post('/api/v1/admin/banners', [
            'image' => UploadedFile::fake()->image('promo.jpg', 1200, 600),
            'title' => 'Eid Sale',
        ])->assertStatus(422)->assertJsonValidationErrors('tenant_id');

        $banner = $this->asAdmin()->post('/api/v1/admin/banners', [
            'image' => UploadedFile::fake()->image('promo.jpg', 1200, 600),
            'title' => 'Eid Sale', 'tenant_id' => $this->shop->id,
        ])->assertCreated()->json('data');

        $this->assertSame('shop', Banner::query()->find($banner['id'])->target_type);
    }

    public function test_an_edit_that_does_not_mention_the_title_leaves_it_alone(): void
    {
        // Not "the title survives a partial update" for its own sake: the same
        // request class validates the create, where a missing field means
        // absent, and the update, where it means untouched. Sending only what
        // changed is what the panel does everywhere else.
        Storage::fake('public');

        $banner = Banner::query()->create([
            'image_path' => 'banners/a.jpg', 'title' => 'Eid Sale',
            'target_type' => 'shop', 'tenant_id' => $this->shop->id,
            'placement' => 'home', 'is_active' => true,
        ]);

        $this->asAdmin()->postJson("/api/v1/admin/banners/{$banner->id}", [
            'sort_order' => 3,
        ])->assertOk();

        $banner->refresh();
        $this->assertSame('Eid Sale', $banner->title);
        $this->assertSame(3, (int) $banner->sort_order);
    }

    public function test_non_admin_cannot_manage_banners(): void
    {
        $owner = User::factory()->shopOwner($this->shop)->create();
        $this->app['auth']->forgetGuards();
        $this->actingAs($owner)->getJson('/api/v1/admin/banners')->assertForbidden();
    }

    public function test_a_banner_too_large_for_php_is_refused_with_a_reason(): void
    {
        /**
         * "Couldn't save — The image failed to upload."
         *
         * Reported from the admin panel with a 1200x600 PNG out of an image
         * generator. Nothing was wrong with the image: the rule said
         * `max:4096` while PHP's own `upload_max_filesize` defaults to 2M, so
         * anything between two and four megabytes never reached validation at
         * all — the upload arrived invalid and Laravel answered with the least
         * helpful sentence it owns.
         *
         * A rule that promises more than the server accepts is a rule that
         * lies, and the lie surfaces as a mystery. Two megabytes on both
         * sides, and a message that names the cause.
         */
        Storage::fake('public');

        $res = $this->asAdmin()->postJson('/api/v1/admin/banners', [
            // 3 MB: inside the OLD rule, outside what PHP takes.
            'image' => UploadedFile::fake()->create('promo.png', 3072, 'image/png'),
            'target_type' => 'none',
            'placement' => 'home',
        ]);

        $res->assertStatus(422);
        $this->assertStringContainsString(
            '2 MB',
            (string) $res->json('errors.image.0'),
            'the refusal has to say WHAT is wrong, not that something failed',
        );
    }

    public function test_a_banner_within_the_limit_still_saves(): void
    {
        // The denominator. Without this, tightening the rule to zero would
        // pass the test above and break every upload.
        Storage::fake('public');

        $this->asAdmin()->postJson('/api/v1/admin/banners', [
            'image' => UploadedFile::fake()->create('promo.jpg', 400, 'image/jpeg'),
            'target_type' => 'none',
            'placement' => 'home',
        ])->assertCreated();
    }

    // ── The shape of the artwork ─────────────────────────────────────

    /**
     * "BANNER CUTTING ON MOBILE, NOT FULL BANNER SHOWING."
     *
     * The app draws a banner at exactly 2:1 and fills the card with
     * `resizeMode="cover"`, which keeps the ratio and lets the surplus hang
     * off the edges. So artwork that is not 2:1 is published cropped, on every
     * phone, and nothing anywhere said so — `image` was checked for type and
     * for size and never for shape.
     *
     * Reported against a 1200x480 file, which is the size this very form used
     * to ask for.
     */
    private function upload(int $w, int $h)
    {
        Storage::fake('public');

        return $this->asAdmin()->postJson('/api/v1/admin/banners', [
            'image' => UploadedFile::fake()->image('promo.jpg', $w, $h),
            'target_type' => 'none',
            'placement' => 'home',
        ]);
    }

    public function test_artwork_wider_than_2_to_1_is_refused_and_told_which_edges(): void
    {
        $res = $this->upload(1200, 480)->assertStatus(422);
        $message = (string) $res->json('errors.image.0');

        // The three things somebody can act on: what they sent, what is
        // wanted, and which part of their own picture disappears.
        $this->assertStringContainsString('1200x480', $message);
        $this->assertStringContainsString('1200x600', $message);
        $this->assertStringContainsString('left and right', $message);

        // 480/600 of the width survives, so a fifth is lost. Asserted because
        // the first version of this message said "top and bottom" — `cover`
        // scales a too-wide image to the card's HEIGHT and spills sideways,
        // and a warning pointing at the wrong axis sends somebody to move the
        // text they were already right about.
        $this->assertStringContainsString('20%', $message);
    }

    public function test_artwork_taller_than_2_to_1_is_refused_and_told_the_other_edges(): void
    {
        // The other half of the rule, and the half nobody reports — a square
        // logo uploaded as a banner loses half of itself.
        $message = (string) $this->upload(600, 600)->assertStatus(422)->json('errors.image.0');

        $this->assertStringContainsString('top and bottom', $message);
        $this->assertStringContainsString('50%', $message);
    }

    public function test_the_size_the_form_asks_for_is_accepted(): void
    {
        // THE DENOMINATOR. A ratio rule that refuses everything would pass
        // both tests above, and the form would be asking for a file it
        // rejects.
        $this->upload(1200, 600)->assertCreated();
    }

    public function test_a_ratio_nobody_can_see_is_not_refused(): void
    {
        /**
         * `dimensions:ratio=2/1` would refuse this, and a refusal has to be
         * about something the person can see. 1200x610 crops by eight pixels
         * off a 1200-pixel width — under one percent, on one axis.
         *
         * A rule strict enough to be arithmetically pure is a rule that sends
         * designers back to a file that was fine.
         */
        $this->upload(1200, 610)->assertCreated();
    }

    public function test_a_file_that_is_not_an_image_is_still_refused_for_being_a_file(): void
    {
        // The shape check reads the pixels, so it has to stay silent about a
        // file it cannot open — otherwise a text file renamed to .jpg gets a
        // lecture about aspect ratios instead of being told it is not an
        // image.
        Storage::fake('public');

        $message = (string) $this->asAdmin()->postJson('/api/v1/admin/banners', [
            'image' => UploadedFile::fake()->create('notes.txt', 10, 'text/plain'),
            'target_type' => 'none',
            'placement' => 'home',
        ])->assertStatus(422)->json('errors.image.0');

        $this->assertStringContainsString('not an image', $message);
        $this->assertStringNotContainsString('2:1', $message);
    }
}
