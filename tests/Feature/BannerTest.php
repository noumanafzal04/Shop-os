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
            'image' => UploadedFile::fake()->image('promo.jpg'),
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
            'image' => UploadedFile::fake()->image('x.jpg'), 'target_type' => 'shop',
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

    public function test_non_admin_cannot_manage_banners(): void
    {
        $owner = User::factory()->shopOwner($this->shop)->create();
        $this->app['auth']->forgetGuards();
        $this->actingAs($owner)->getJson('/api/v1/admin/banners')->assertForbidden();
    }
}
