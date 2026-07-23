<?php

namespace App\Services;

use App\Exceptions\DomainException;
use App\Models\Review;
use App\Models\Tenant;
use App\Models\User;

/**
 * Shop reviews.
 *
 * Edge cases:
 *  - duplicate review        → upsert: re-posting updates the customer's
 *                              existing review (unique per shop+customer)
 *  - offensive language      → blocked with OFFENSIVE_CONTENT (simple
 *                              wordlist hook — provider/AI moderation can
 *                              replace it without touching callers)
 *  - deleted/hidden shop     → public reviews vanish with the shop (the
 *                              marketplaceVisible scope guards every read),
 *                              but rows are retained
 */
class ReviewService
{
    /** Placeholder moderation list — swap for a real service later. */
    private const BLOCKED_WORDS = ['scam', 'fraudster', 'stupid', 'idiot'];

    public function upsert(User $customer, Tenant $shop, array $data): Review
    {
        $this->guardContent($data['comment'] ?? null);

        return Review::withoutTenancy()->updateOrCreate(
            ['tenant_id' => $shop->id, 'customer_id' => $customer->id],
            [
                'rating' => (int) $data['rating'],
                'comment' => $data['comment'] ?? null,
                'is_published' => true,
                // A re-review invalidates the owner's old reply.
                'reply' => null,
                'replied_at' => null,
            ],
        );
    }

    public function reply(Review $review, string $reply): Review
    {
        $this->guardContent($reply);

        $review->forceFill([
            'reply' => $reply,
            'replied_at' => now(),
        ])->save();

        return $review;
    }

    /** @return array{average: float|null, count: int} */
    public function aggregate(string $tenantId): array
    {
        $stats = Review::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->where('is_published', true)
            ->selectRaw('AVG(rating) as average, COUNT(*) as total')
            ->first();

        return [
            'average' => $stats->total > 0 ? round((float) $stats->average, 1) : null,
            'count' => (int) $stats->total,
        ];
    }

    private function guardContent(?string $text): void
    {
        if ($text === null) {
            return;
        }

        foreach (self::BLOCKED_WORDS as $word) {
            if (stripos($text, $word) !== false) {
                throw DomainException::unprocessable(
                    'Please keep your review respectful — offensive language is not allowed.',
                    'OFFENSIVE_CONTENT',
                );
            }
        }
    }
}
