<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductImage;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Thumbnail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Small square versions of product photos.
 *
 * A phone photo is 2–4 MB and a restaurant's POS renders its menu as a grid of
 * them, so a 300-item menu was asking a counter tablet for roughly a gigabyte
 * over a shop's connection — before the first order of the day. That is already
 * the slowest thing about the online till, and offline it is simply impossible
 * because a device cannot hold it.
 *
 * The rule that shapes every test here: **failing to make one must never cost a
 * shopkeeper their photo.** A corrupt upload, an unknown format, a PHP built
 * without WebP — each leaves the original in place and everything falls back to
 * it, which is exactly how the grid behaved yesterday.
 */
class ProductThumbnailTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('public');

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'food',
            'features' => BusinessTypes::defaultFeatures('food') + ['images' => true],
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->product = Product::query()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Chicken Biryani', 'price' => 450, 'track_inventory' => false, 'is_active' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── Making one ──────────────────────────────────────────────────

    public function test_a_photo_gets_a_small_square_when_it_is_uploaded(): void
    {
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/products/{$this->product->id}/images", [
                'images' => [UploadedFile::fake()->image('biryani.jpg', 1600, 1200)],
            ])
            ->assertOk();

        $image = ProductImage::withoutTenancy()->first();

        $this->assertNotNull($image->thumb_path, 'The grid would download the full photo.');
        Storage::disk('public')->assertExists($image->thumb_path);
    }

    public function test_the_square_is_very_much_smaller_than_the_photo(): void
    {
        // The whole point. If it were not, a menu grid would still be a
        // gigabyte and nothing would have been gained.
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/products/{$this->product->id}/images", [
                'images' => [UploadedFile::fake()->image('biryani.jpg', 2400, 1800)],
            ])
            ->assertOk();

        $image = ProductImage::withoutTenancy()->first();
        $disk = Storage::disk('public');

        $this->assertLessThan(
            $disk->size($image->path),
            $disk->size($image->thumb_path),
            'A thumbnail bigger than its original has achieved nothing.',
        );
    }

    public function test_it_is_a_square_of_the_declared_size(): void
    {
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/products/{$this->product->id}/images", [
                'images' => [UploadedFile::fake()->image('wide.jpg', 1600, 400)],
            ])
            ->assertOk();

        $image = ProductImage::withoutTenancy()->first();
        [$width, $height] = getimagesizefromstring(Storage::disk('public')->get($image->thumb_path));

        $this->assertSame(Thumbnail::SIZE, $width);
        $this->assertSame(Thumbnail::SIZE, $height);
    }

    public function test_a_wide_photo_is_centre_cropped_rather_than_squashed(): void
    {
        // A POS grid is squares. Letterboxing every tile to fit a wide photo
        // wastes a third of a screen the cashier reads at arm's length, and
        // squashing it makes a plate of food look like a different dish.
        //
        // The image is 400×200: red down each end, blue in the middle 200×200.
        // A correct centre crop is therefore ENTIRELY BLUE. Anything that took
        // the full width — squashing or letterboxing — drags red into it, and
        // asserting the output is 200×200 would not notice either.
        $canvas = imagecreatetruecolor(400, 200);
        $red = imagecolorallocate($canvas, 255, 0, 0);
        $blue = imagecolorallocate($canvas, 0, 0, 255);
        imagefilledrectangle($canvas, 0, 0, 399, 199, $red);
        imagefilledrectangle($canvas, 100, 0, 299, 199, $blue);
        ob_start();
        imagepng($canvas);
        Storage::disk('public')->put('products/wide.png', (string) ob_get_clean());
        imagedestroy($canvas);

        $thumbPath = Thumbnail::make('products/wide.png');
        $this->assertNotNull($thumbPath);

        $thumb = imagecreatefromstring((string) Storage::disk('public')->get($thumbPath));
        $corner = imagecolorsforindex($thumb, imagecolorat($thumb, 2, 100));
        imagedestroy($thumb);

        $this->assertGreaterThan(200, $corner['blue'], 'The left edge should be inside the blue band.');
        $this->assertLessThan(60, $corner['red'], 'Red at the edge means the crop took the whole width.');
    }

    public function test_the_thumbnail_lives_beside_its_original(): void
    {
        // Derived from the original's path rather than stored separately, so
        // the two can never point at different files, and deleting a product's
        // image folder takes its thumbnails with it.
        $this->assertSame(
            'products/t1/p1/photo_thumb.webp',
            Thumbnail::pathFor('products/t1/p1/photo.jpg'),
        );
    }

    // ── Failing to make one is never fatal ──────────────────────────

    public function test_a_file_that_is_not_an_image_keeps_its_row_and_its_original(): void
    {
        // Uploaded with an image extension but no image inside it. The photo
        // must survive; only the thumbnail is missing.
        Storage::disk('public')->put('products/broken.jpg', 'this is not an image');

        $this->assertNull(Thumbnail::make('products/broken.jpg'));
        Storage::disk('public')->assertExists('products/broken.jpg');
    }

    public function test_a_missing_original_does_not_throw(): void
    {
        $this->assertNull(Thumbnail::make('products/not-here-at-all.jpg'));
    }

    public function test_the_url_falls_back_to_the_original_when_there_is_no_thumbnail(): void
    {
        // A photo uploaded before thumbnails existed still shows — slowly,
        // which is how it showed yesterday, rather than not at all.
        $image = ProductImage::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'product_id' => $this->product->id,
            'path' => 'products/old-photo.jpg',
            'thumb_path' => null,
            'sort_order' => 0,
        ]);

        $this->assertSame($image->url, $image->thumb_url);
        $this->assertNotNull($image->thumb_url);
    }

    // ── What the till is given ──────────────────────────────────────

    public function test_the_till_is_given_the_smal_l_square_and_not_the_photo(): void
    {
        // Sending the full-size URL would invite a client to cache 2–4 MB per
        // item, and there is no shop where that ends well.
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/products/{$this->product->id}/images", [
                'images' => [UploadedFile::fake()->image('biryani.jpg', 1600, 1200)],
            ])
            ->assertOk();

        $item = $this->actingAsUser($this->owner)->getJson('/api/v1/pos/bootstrap')
            ->assertOk()->json('data.products.items.0');

        $this->assertStringContainsString('_thumb.webp', $item['image']);
    }

    public function test_an_item_with_no_photo_carries_null_rather_than_a_broken_link(): void
    {
        $item = $this->actingAsUser($this->owner)->getJson('/api/v1/pos/bootstrap')
            ->assertOk()->json('data.products.items.0');

        $this->assertNull($item['image']);
    }

    // ── The backfill ────────────────────────────────────────────────

    public function test_the_backfill_makes_squares_for_photos_that_predate_them(): void
    {
        // The shops that have been running longest have the biggest menus, and
        // they are exactly the ones a POS grid hurts most.
        $file = UploadedFile::fake()->image('old.jpg', 900, 900);
        $path = $file->store("products/{$this->tenant->id}/{$this->product->id}", 'public');
        ProductImage::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $this->product->id,
            'path' => $path, 'thumb_path' => null, 'sort_order' => 0,
        ]);

        $this->artisan('images:thumbnails')->assertSuccessful();

        $this->assertNotNull(ProductImage::withoutTenancy()->first()->thumb_path);
    }

    public function test_running_the_backfill_twice_is_harmless(): void
    {
        // It has to be safe to interrupt and safe to re-run: a shop's images
        // can be thousands of files.
        $file = UploadedFile::fake()->image('old.jpg', 900, 900);
        $path = $file->store('products', 'public');
        ProductImage::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $this->product->id,
            'path' => $path, 'thumb_path' => null, 'sort_order' => 0,
        ]);

        $this->artisan('images:thumbnails')->assertSuccessful();
        $first = ProductImage::withoutTenancy()->first()->thumb_path;

        $this->artisan('images:thumbnails')->assertSuccessful();

        $this->assertSame($first, ProductImage::withoutTenancy()->first()->thumb_path);
    }

    public function test_the_backfill_leaves_a_photo_it_cannot_read_alone(): void
    {
        Storage::disk('public')->put('products/broken.jpg', 'not an image');
        ProductImage::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $this->product->id,
            'path' => 'products/broken.jpg', 'thumb_path' => null, 'sort_order' => 0,
        ]);

        $this->artisan('images:thumbnails')->assertSuccessful();

        // Row intact, original intact, thumbnail simply absent.
        $this->assertNull(ProductImage::withoutTenancy()->first()->thumb_path);
        Storage::disk('public')->assertExists('products/broken.jpg');
    }
}
