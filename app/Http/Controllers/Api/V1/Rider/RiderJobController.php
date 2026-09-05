<?php

namespace App\Http\Controllers\Api\V1\Rider;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\RiderProfile;
use App\Services\OrderService;
use App\Services\RiderService;
use App\Support\ApiResponse;
use App\Support\RiderJobView;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A rider's working day.
 *
 * Every read here goes through `RiderService`, which owns the fence — see its
 * class docblock for why a hand-written one is the only kind available on this
 * side of the app.
 */
class RiderJobController extends Controller
{
    /**
     * ONE call, the whole screen.
     *
     * The rider app polls this while it is open, so it answers duty state,
     * current jobs and the board together rather than making a phone on a
     * patchy connection ask three times and render a screen assembled from
     * three different moments.
     */
    public function board(Request $request, RiderService $riders): JsonResponse
    {
        $profile = $this->mine($request);
        $active = $riders->activeJobs($profile);

        return ApiResponse::ok([
            'is_online' => $profile->is_online,
            'can_ride' => $profile->status->canRide(),
            'status' => $profile->status->value,
            'active' => $active->map(fn (Order $o) => RiderJobView::job($o, $profile))->values(),
            'offers' => $riders->openOffers($profile)
                ->map(fn (Order $o) => RiderJobView::offer($o, $profile))->values(),
            'job_limit' => RiderService::MAX_ACTIVE_JOBS,
            'earnings_today' => $riders->earnings($profile, now()->toDateString(), now()->toDateString()),
            // What the phone shows beside the refresh control. Sent by the
            // server because a phone's clock is not evidence of anything.
            'as_of' => now()->toIso8601String(),
        ]);
    }

    public function accept(Request $request, string $id, RiderService $riders): JsonResponse
    {
        $profile = $this->mine($request);
        $order = $riders->accept($profile, $id);

        return ApiResponse::ok(RiderJobView::job($order, $profile), 'Order accepted');
    }

    public function decline(Request $request, string $id, RiderService $riders): JsonResponse
    {
        $riders->decline($this->mine($request), $id);

        return ApiResponse::ok(null, 'Handed back');
    }

    public function pickUp(Request $request, string $id, RiderService $riders, OrderService $orders): JsonResponse
    {
        $profile = $this->mine($request);
        $order = $riders->pickUp($profile, $id, $orders);

        return ApiResponse::ok(RiderJobView::job($order, $profile), 'Collected — on the way');
    }

    public function deliver(Request $request, string $id, RiderService $riders, OrderService $orders): JsonResponse
    {
        $data = $request->validate([
            'code' => ['nullable', 'string', 'max:8'],
        ]);

        $profile = $this->mine($request);
        $order = $riders->deliver($profile, $id, $data['code'] ?? null, $orders);

        return ApiResponse::ok(RiderJobView::job($order, $profile), 'Delivered');
    }

    /** Past work. Paginated, because a year of it is not a screen. */
    public function history(Request $request): JsonResponse
    {
        $profile = $this->mine($request);

        $cards = $profile->cards()->pluck('id')->all();

        $orders = $cards === []
            ? Order::withoutTenancy()->whereRaw('1 = 0')->paginate(20)
            : Order::withoutTenancy()
                ->whereIn('rider_id', $cards)
                ->whereNotNull('delivered_at')
                ->with(RiderService::JOB_RELATIONS)
                ->orderByDesc('delivered_at')
                ->paginate(20);

        $orders->through(fn (Order $o) => RiderJobView::job($o, $profile));

        return ApiResponse::paginated($orders);
    }

    public function earnings(Request $request, RiderService $riders): JsonResponse
    {
        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
        ]);

        return ApiResponse::ok($riders->earnings(
            $this->mine($request),
            $data['from'] ?? now()->startOfMonth()->toDateString(),
            $data['to'] ?? now()->toDateString(),
        ));
    }

    private function mine(Request $request): RiderProfile
    {
        $profile = RiderProfile::query()->with('user:id,name,phone')->where('user_id', $request->user()->id)->first();

        if ($profile === null) {
            throw DomainException::forbidden('You have not applied to ride yet.', 'RIDER_NO_PROFILE');
        }

        return $profile;
    }
}
