<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Demo\ApproveShopRequestAction;
use App\Http\Controllers\Controller;
use App\Models\ShopRequest;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Demos asking to become businesses, for whoever opens shops.
 *
 * ── Oldest first, and that is the whole design ─────────────────────────
 *
 * Nothing deletes a shop while its owner is waiting for an answer — the prune
 * skips a tenant with a request outstanding — which means a slow reply costs
 * the customer nothing and costs this list its only discipline. So the list is
 * ordered by how long somebody has been waiting, and the age of the oldest one
 * is the number that says whether this is being run properly.
 */
class ShopRequestController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $rows = ShopRequest::query()
            ->with(['tenant:id,business_name,business_type,slug,demo_expires_at', 'reviewer:id,name'])
            ->when(
                $request->query('status', ShopRequest::PENDING) !== 'all',
                fn ($q) => $q->where('status', $request->query('status', ShopRequest::PENDING)),
            )
            // The person who has waited longest is the person to answer next.
            ->orderBy('requested_at')
            ->paginate(25);

        return ApiResponse::paginated($rows);
    }

    public function approve(Request $request, string $id, ApproveShopRequestAction $approve): JsonResponse
    {
        $shopRequest = ShopRequest::query()->where('status', ShopRequest::PENDING)->findOrFail($id);

        $approved = $approve->execute($request->user(), $shopRequest);

        return ApiResponse::ok(
            $approved->load('tenant'),
            'Approved. The shop is real now — assign it a plan and set the owner a password.',
        );
    }

    public function decline(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            // Required, because "declined" with no reason is a thing nobody can
            // act on later — including whoever picks up the conversation next.
            'reason' => ['required', 'string', 'max:500'],
        ]);

        $shopRequest = ShopRequest::query()->where('status', ShopRequest::PENDING)->findOrFail($id);

        $shopRequest->forceFill([
            'status' => ShopRequest::DECLINED,
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
            'decline_reason' => $data['reason'],
        ])->save();

        // The shop goes back to being a demo on its ORIGINAL clock. It is not
        // deleted here: whatever they built stays until that hour comes, and
        // the banner tells them what was decided.
        return ApiResponse::ok($shopRequest->fresh(), 'Declined. The shop returns to being a demo.');
    }
}
