<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Review;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class ReviewsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function review(int $rating = 5, string $comment = 'Great shop!'): \Illuminate\Testing\TestResponse
    {
        return $this->actingAsUser($this->customer)->postJson('/api/v1/customer/reviews', [
            'shop_slug' => $this->shop->slug,
            'rating' => $rating,
            'comment' => $comment,
        ]);
    }

    // ── Create / update ─────────────────────────────────────────────

    public function test_customer_reviews_shop_and_it_appears_publicly(): void
    {
        $this->review()->assertCreated();

        // Public, no auth.
        $reviews = $this->getJson("/api/v1/marketplace/shops/{$this->shop->slug}/reviews")
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $reviews);
        $this->assertSame(5, $reviews[0]['rating']);
        $this->assertSame('Great shop!', $reviews[0]['comment']);
    }

    public function test_duplicate_review_updates_instead_of_stacking(): void
    {
        $this->review(5, 'Amazing');
        $this->review(2, 'Actually mediocre');

        $this->assertSame(1, Review::withoutTenancy()->count());
        $this->assertSame(2, Review::withoutTenancy()->first()->rating);
    }

    public function test_rating_bounds_enforced(): void
    {
        $this->review(0)->assertStatus(422);
        $this->review(6)->assertStatus(422);
    }

    public function test_offensive_language_blocked(): void
    {
        $this->review(1, 'This shop is a total scam')
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'OFFENSIVE_CONTENT');
    }

    public function test_shop_rating_aggregates_on_marketplace(): void
    {
        $this->review(5);
        $other = User::factory()->create();
        $this->actingAsUser($other)->postJson('/api/v1/customer/reviews', [
            'shop_slug' => $this->shop->slug, 'rating' => 2,
        ]);

        $shop = $this->getJson("/api/v1/marketplace/shops/{$this->shop->slug}")
            ->assertOk()
            ->json('data');

        $this->assertSame(3.5, $shop['rating']);
        $this->assertSame(2, $shop['reviews_count']);
    }

    public function test_customer_can_delete_own_review_only(): void
    {
        $this->review();
        $review = Review::withoutTenancy()->first();

        $other = User::factory()->create();
        $this->actingAsUser($other)->deleteJson("/api/v1/customer/reviews/{$review->id}")
            ->assertStatus(404);

        $this->actingAsUser($this->customer)->deleteJson("/api/v1/customer/reviews/{$review->id}")
            ->assertOk();
        $this->assertSame(0, Review::withoutTenancy()->count());
    }

    // ── Owner reply ─────────────────────────────────────────────────

    public function test_owner_replies_and_reply_shows_publicly(): void
    {
        $this->review(4, 'Good but slow delivery');
        $review = Review::withoutTenancy()->first();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/reviews/{$review->id}/reply", [
                'reply' => 'Thanks! We are speeding things up.',
            ])->assertOk();

        $public = $this->getJson("/api/v1/marketplace/shops/{$this->shop->slug}/reviews")
            ->json('data');
        $this->assertSame('Thanks! We are speeding things up.', $public[0]['reply']);
    }

    public function test_re_review_clears_stale_owner_reply(): void
    {
        $this->review(4);
        $review = Review::withoutTenancy()->first();
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/reviews/{$review->id}/reply", ['reply' => 'Old reply']);

        $this->review(1, 'Changed my mind');

        $this->assertNull(Review::withoutTenancy()->first()->reply);
    }

    public function test_owner_cannot_reply_to_other_shops_reviews(): void
    {
        $this->review();
        $review = Review::withoutTenancy()->first();

        $otherOwner = User::factory()->shopOwner()->create();
        $this->actingAsUser($otherOwner)
            ->postJson("/api/v1/reviews/{$review->id}/reply", ['reply' => 'Hijack'])
            ->assertStatus(404); // tenant scope hides it
    }

    // ── Visibility / authz ──────────────────────────────────────────

    public function test_hidden_reviews_excluded_from_public_and_aggregates(): void
    {
        $this->review(1, 'Bad experience');
        Review::withoutTenancy()->first()->forceFill(['is_published' => false])->save();

        $this->assertCount(0, $this->getJson("/api/v1/marketplace/shops/{$this->shop->slug}/reviews")->json('data'));

        $shop = $this->getJson("/api/v1/marketplace/shops/{$this->shop->slug}")->json('data');
        $this->assertNull($shop['rating']);

        // Owner still sees it in their list (with the flag).
        $ownerList = $this->actingAsUser($this->owner)->getJson('/api/v1/reviews')->json('data');
        $this->assertCount(1, $ownerList);
        $this->assertFalse($ownerList[0]['is_published']);
    }

    public function test_reviews_of_hidden_shop_are_retained_but_unreachable(): void
    {
        $this->review();
        $this->shop->forceFill(['online_shop_enabled' => false])->save(); // downgraded

        $this->getJson("/api/v1/marketplace/shops/{$this->shop->slug}/reviews")
            ->assertStatus(404);
        $this->assertSame(1, Review::withoutTenancy()->count()); // data safe
    }

    public function test_owner_cannot_post_customer_reviews(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/customer/reviews', [
            'shop_slug' => $this->shop->slug, 'rating' => 5,
        ])->assertStatus(403);
    }
}
