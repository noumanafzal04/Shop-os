<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Phase 9: the fences held, the words did not.
 *
 * #NE1 — a text file offered as a product picture was told "The images.0 field
 * must be an image." (twice, with the mimes line), and a 9 MB photo "The POST
 * data is too large." — a form field nobody sees, and PHP's own sentence.
 *
 * #NE2 — the 429 carried no Retry-After. The throttle puts it on the exception;
 * the API's envelope was built without the exception's headers, so the panel,
 * which reads the header, guessed "wait 30 seconds" against a per-minute limit.
 */
class RefusalsSayHowAndHowLongTest extends TestCase
{
    use RefreshDatabase;

    private const NOT_A_PICTURE = 'That file is not a picture. Use a JPG, PNG or WebP under 4 MB.';

    public function test_a_throttled_sign_in_is_told_how_long_to_wait(): void
    {
        $owner = User::factory()->shopOwner(Tenant::factory()->create(['setup_completed' => true]))->create();

        for ($i = 1; $i <= 5; $i++) {
            $this->postJson('/api/v1/auth/login', ['identifier' => $owner->email, 'password' => 'not-it'])->assertStatus(401);
        }

        $refused = $this->postJson('/api/v1/auth/login', ['identifier' => $owner->email, 'password' => 'not-it'])
            ->assertStatus(429)
            ->assertJsonPath('meta.error_code', 'RATE_LIMITED');

        $wait = $refused->headers->get('Retry-After');
        $this->assertNotNull($wait, 'a 429 that names no wait leaves the screen to guess one');
        $this->assertGreaterThan(0, (int) $wait);
        $this->assertLessThanOrEqual(60, (int) $wait, 'the sign-in limiter counts per minute');
        $this->assertSame('5', $refused->headers->get('X-RateLimit-Limit'));
    }

    public function test_a_file_too_large_to_send_is_said_in_plain_words(): void
    {
        $this->call('POST', '/api/v1/auth/login', [], [], [], [
            'CONTENT_LENGTH' => (string) (64 * 1024 * 1024),
            'HTTP_ACCEPT' => 'application/json',
        ])
            ->assertStatus(413)
            ->assertJsonPath('meta.error_code', 'TOO_LARGE')
            ->assertJsonPath('message', 'That file is too large to send. Make it smaller and try again — nothing was saved.');
    }

    public function test_a_refused_product_picture_is_said_once_in_the_shops_words(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('public');
        $tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'food',
            'features' => BusinessTypes::defaultFeatures('food') + ['images' => true],
        ]);
        $owner = User::factory()->shopOwner($tenant)->create();
        $product = Product::query()->create([
            'tenant_id' => $tenant->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Chicken Biryani', 'price' => 450, 'track_inventory' => false, 'is_active' => true,
        ]);
        $as = fn () => $this->withToken($owner->createToken('t', ['access'])->plainTextToken);
        $url = "/api/v1/products/{$product->id}/images";

        $as()->post($url, ['images' => [UploadedFile::fake()->create('notes.txt', 2, 'text/plain')]], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('errors', ['images.0' => [self::NOT_A_PICTURE]]);

        // Text renamed .jpg — a REAL file, read by its content as an upload is.
        // (A fake one reports the type its name suggests, and passes.)
        $renamed = tempnam(sys_get_temp_dir(), 'nep');
        file_put_contents($renamed, "just some text, not a picture\n");
        $as()->post($url, ['images' => [new UploadedFile($renamed, 'fake.jpg', 'image/jpeg', null, true)]], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('errors', ['images.0' => [self::NOT_A_PICTURE]]);

        // A picture, but not one a till or a shop page draws.
        $as()->post($url, ['images' => [UploadedFile::fake()->image('moving.gif')]], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('errors', ['images.0' => [self::NOT_A_PICTURE]]);

        // Not a picture AND too big — one sentence, the first that is true.
        $as()->post($url, ['images' => [UploadedFile::fake()->create('notes.txt', 5000, 'text/plain')]], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('errors', ['images.0' => [self::NOT_A_PICTURE]]);

        $as()->post($url, ['images' => [UploadedFile::fake()->image('huge.jpg')->size(5000)]], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('errors', ['images.0' => ['That picture is over 4 MB. Use a JPG, PNG or WebP under 4 MB.']]);

        $this->assertSame(0, $product->images()->count());
    }
}
