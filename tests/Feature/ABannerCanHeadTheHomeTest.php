<?php

namespace Tests\Feature;

use App\Models\Banner;
use App\Models\User;
use App\Support\HeroColor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * A TOP-HEADER BANNER: the admin picks its colour, words, button, link and
 * picture (or uploads finished artwork), and it is shown ONLY at the top of
 * the app's home, the block taking its colour.
 */
class ABannerCanHeadTheHomeTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->admin = User::factory()->superAdmin()->create();
        Storage::fake('public');
    }

    private function make(array $fields)
    {
        $this->app['auth']->forgetGuards();

        return $this->actingAs($this->admin)->postJson('/api/v1/admin/banners', $fields + [
            'target_type' => 'url',
            'target_url' => 'https://example.com/eid',
            'placement' => 'home_top',
        ]);
    }

    private function words(array $over = []): array
    {
        return $over + [
            'hero_style' => 'words',
            'hero_color' => '#7a1f5c',
            'title' => 'Eid deals are here',
            'body' => 'Up to half off at shops near you',
            'cta_label' => 'Order now',
            'hero_image_size' => 120,
        ];
    }

    public function test_a_words_banner_saves_with_no_picture(): void
    {
        $b = $this->make($this->words())->assertCreated()->json('data');

        $this->assertNull($b['image_path'] ?? null);
        $this->assertNull($b['image_url']);
        $this->assertSame('#7a1f5c', $b['hero_color']);
        $this->assertSame('Order now', $b['cta_label']);
        $this->assertSame(120, $b['hero_image_size']);
    }

    public function test_a_words_banner_takes_a_picture_of_any_shape(): void
    {
        // A square cutout beside the words — the 2:1 rule is for artwork
        // that fills a card, and would refuse this as "loses 50%".
        $this->make($this->words(['image' => UploadedFile::fake()->image('cutout.png', 400, 400)]))
            ->assertCreated();
    }

    public function test_full_artwork_is_still_held_to_two_to_one(): void
    {
        $this->make(['hero_style' => 'artwork', 'hero_color' => '#0b4f4a', 'image' => UploadedFile::fake()->image('a.jpg', 600, 600)])
            ->assertStatus(422)->assertJsonValidationErrors('image');

        $this->make(['hero_style' => 'artwork', 'hero_color' => '#0b4f4a', 'image' => UploadedFile::fake()->image('a.jpg', 1200, 600)])
            ->assertCreated();
    }

    public function test_full_artwork_needs_its_artwork(): void
    {
        $this->make(['hero_style' => 'artwork', 'hero_color' => '#0b4f4a'])
            ->assertStatus(422)->assertJsonValidationErrors('image');
    }

    public function test_a_top_banner_needs_its_colour_its_style_and_a_words_one_its_title(): void
    {
        $this->make(['hero_style' => 'words', 'title' => 'x'])->assertStatus(422)->assertJsonValidationErrors('hero_color');
        $this->make(['hero_color' => '#7a1f5c', 'title' => 'x'])->assertStatus(422)->assertJsonValidationErrors('hero_style');
        $this->make($this->words(['title' => '']))->assertStatus(422)->assertJsonValidationErrors('title');
    }

    public function test_a_colour_white_cannot_be_read_on_is_refused_with_the_number(): void
    {
        $msg = (string) $this->make($this->words(['hero_color' => '#ffd54f']))
            ->assertStatus(422)->json('errors.hero_color.0');

        $this->assertStringContainsString('#ffd54f', $msg);
        $this->assertStringContainsString('3:1', $msg);

        // The denominator: the brand teal and a deep red read under white.
        $this->assertTrue(HeroColor::readsUnderWhite('#03444a'));
        $this->assertTrue(HeroColor::readsUnderWhite('#c62828'));
        $this->assertFalse(HeroColor::readsUnderWhite('#ffffff'));
    }

    public function test_a_banner_below_the_header_still_needs_its_image(): void
    {
        $this->make(['placement' => 'home', 'target_type' => 'none'])
            ->assertStatus(422)->assertJsonValidationErrors('image');
    }

    public function test_the_home_feed_shows_a_top_banner_only_at_the_top(): void
    {
        $top = $this->make($this->words())->assertCreated()->json('data.id');
        Banner::query()->create([
            'image_path' => 'banners/strip.jpg', 'target_type' => 'none', 'placement' => 'home', 'is_active' => true,
        ]);

        $this->app['auth']->forgetGuards();
        $data = $this->actingAs(User::factory()->create())
            ->getJson('/api/v1/marketplace/home')->assertOk()->json('data');

        $this->assertSame([$top], array_column($data['hero'], 'id'));
        $this->assertNotContains($top, array_column($data['banners'], 'id'));
        $this->assertCount(1, $data['banners']);

        $hero = $data['hero'][0];
        $this->assertSame('#7a1f5c', $hero['color']);
        $this->assertSame('words', $hero['style']);
        $this->assertSame('Up to half off at shops near you', $hero['body']);
        $this->assertSame('Order now', $hero['cta']);
        $this->assertSame(120, $hero['image_size']);
        $this->assertSame(['type' => 'url', 'url' => 'https://example.com/eid'], $hero['target']);
    }

    public function test_an_edit_that_only_renames_a_words_banner_keeps_the_rest(): void
    {
        $id = $this->make($this->words())->assertCreated()->json('data.id');

        $this->app['auth']->forgetGuards();
        $this->actingAs($this->admin)->postJson("/api/v1/admin/banners/{$id}", ['title' => 'Eid Mubarak'])->assertOk();

        $b = Banner::query()->findOrFail($id);
        $this->assertSame('Eid Mubarak', $b->title);
        $this->assertSame('#7a1f5c', $b->hero_color);
        $this->assertNull($b->image_path);
    }
}
