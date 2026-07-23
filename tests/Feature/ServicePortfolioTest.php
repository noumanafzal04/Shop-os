<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\GalleryImage;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ServicePortfolioTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'salon', 'features' => BusinessTypes::defaultFeatures('salon'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_owner_uploads_and_deletes_gallery_photos(): void
    {
        Storage::fake('public');

        $res = $this->actingAsUser($this->owner)->postJson('/api/v1/shop/gallery', [
            'images' => [UploadedFile::fake()->image('cut1.jpg'), UploadedFile::fake()->image('cut2.jpg')],
        ])->assertOk()->json('data');

        $this->assertCount(2, $res);
        $this->assertArrayHasKey('url', $res[0]);
        Storage::disk('public')->assertExists($res[0]['path']);

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/shop/gallery/{$res[0]['id']}")->assertOk();
        $this->assertSame(1, GalleryImage::withoutTenancy()->count());
    }

    public function test_gallery_upload_rejects_non_images(): void
    {
        Storage::fake('public');
        $this->actingAsUser($this->owner)->postJson('/api/v1/shop/gallery', [
            'images' => [UploadedFile::fake()->create('flyer.pdf', 50, 'application/pdf')],
        ])->assertStatus(422);
    }

    public function test_service_area_saved_via_settings(): void
    {
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', [
            'service_area' => 'We serve Gulberg, DHA and Model Town.',
        ])->assertOk()->assertJsonPath('data.service_area', 'We serve Gulberg, DHA and Model Town.');
    }

    public function test_marketplace_shop_exposes_gallery_and_service_area(): void
    {
        // salon isn't marketplace-visible by default; use a visible type instead.
        $this->shop->forceFill([
            'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
            'online_shop_enabled' => true,
        ])->save();
        GalleryImage::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'path' => 'gallery/x/a.jpg', 'sort_order' => 0]);
        $this->shop->forceFill(['settings' => ['service_area' => 'Citywide']])->save();

        $customer = User::factory()->create();
        $data = $this->actingAsUser($customer)->getJson("/api/v1/marketplace/shops/{$this->shop->slug}")->json('data');

        $this->assertSame('Citywide', $data['service_area']);
        $this->assertCount(1, $data['gallery']);
    }

    public function test_staff_without_settings_permission_cannot_upload(): void
    {
        Storage::fake('public');
        $staff = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();
        $this->actingAsUser($staff)->postJson('/api/v1/shop/gallery', [
            'images' => [UploadedFile::fake()->image('x.jpg')],
        ])->assertStatus(403);
    }
}
