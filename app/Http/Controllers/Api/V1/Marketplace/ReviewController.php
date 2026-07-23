<?php

namespace App\Http\Controllers\Api\V1\Marketplace;

use App\Http\Controllers\Controller;
use App\Models\Review;
use App\Models\Tenant;
use App\Services\ReviewService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReviewController extends Controller
{
    /**
     * PUBLIC: a shop's published reviews.
     */
    public function index(Request $request, string $slug): JsonResponse
    {
        $shop = Tenant::query()->marketplaceVisible()->where('slug', $slug)->firstOrFail();

        $reviews = Review::withoutTenancy()
            ->where('tenant_id', $shop->id)
            ->where('is_published', true)
            ->with('customer:id,name')
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 10), 50))
            ->through(fn (Review $r) => [
                'id' => $r->id,
                'rating' => $r->rating,
                'comment' => $r->comment,
                'reply' => $r->reply,
                'replied_at' => $r->replied_at?->toIso8601String(),
                'customer_name' => $r->customer?->name ?? 'Customer',
                'created_at' => $r->created_at?->toIso8601String(),
            ]);

        return ApiResponse::paginated($reviews);
    }

    /**
     * CUSTOMER: create or update own review (one per shop).
     */
    public function store(Request $request, ReviewService $service): JsonResponse
    {
        $data = $request->validate([
            'shop_slug' => ['required', 'string'],
            'rating' => ['required', 'integer', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string', 'max:1000'],
        ]);

        $shop = Tenant::query()->marketplaceVisible()
            ->where('slug', $data['shop_slug'])
            ->firstOrFail();

        $review = $service->upsert($request->user(), $shop, $data);

        return ApiResponse::created($review, 'Thanks for your review!');
    }

    /**
     * CUSTOMER: delete own review.
     */
    public function destroy(Request $request, string $id): JsonResponse
    {
        Review::withoutTenancy()
            ->where('customer_id', $request->user()->id)
            ->findOrFail($id)
            ->delete();

        return ApiResponse::noContent('Review deleted');
    }
}
