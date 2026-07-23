<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\Review;
use App\Services\ReviewService;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Owner side: see reviews, reply publicly. Owners can NOT edit or hide
 * customer reviews — moderation belongs to the platform.
 */
class TenantReviewController extends Controller
{
    public function index(Request $request, ReviewService $service, TenantContext $context): JsonResponse
    {
        $reviews = Review::query()
            ->with('customer:id,name')
            ->when($request->query('rating'), fn ($q, $rating) => $q->where('rating', $rating))
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated($reviews, 'OK');
    }

    public function summary(ReviewService $service, TenantContext $context): JsonResponse
    {
        return ApiResponse::ok($service->aggregate($context->id()));
    }

    public function reply(Request $request, string $id, ReviewService $service): JsonResponse
    {
        $data = $request->validate(['reply' => ['required', 'string', 'max:1000']]);

        $review = $service->reply(Review::query()->findOrFail($id), $data['reply']);

        return ApiResponse::ok($review, 'Reply posted');
    }
}
