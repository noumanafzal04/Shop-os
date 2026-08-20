<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\Coupon\StoreCouponRequest;
use App\Models\Coupon;
use App\Services\CouponService;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CouponController extends Controller
{
    /**
     * The shop's codes, newest first.
     *
     * Searchable because a coupon is FOUND BY ITS CODE and by nothing else — a
     * merchant asked "is EID20 still live?" has a string, not a date. Until
     * this took one, thirty a page with no filter meant a shop that had run a
     * season of campaigns could not reach its older codes at all: not to expire
     * one, not to correct it, not to delete it. The QA sweep found it by
     * becoming that shop — it created enough coupons over enough runs that the
     * one it was looking for fell off page one.
     */
    public function index(Request $request): JsonResponse
    {
        return ApiResponse::paginated(
            Coupon::query()
                ->when($request->query('search'), fn ($q, $s) => $q->where('code', 'like', '%'.$s.'%'))
                ->orderByDesc('created_at')
                ->paginate(min((int) $request->query('per_page', 30), 100)),
        );
    }

    public function store(StoreCouponRequest $request): JsonResponse
    {
        return ApiResponse::created(Coupon::query()->create($request->validated()), 'Coupon created');
    }

    public function show(string $id): JsonResponse
    {
        return ApiResponse::ok(Coupon::query()->findOrFail($id));
    }

    public function update(StoreCouponRequest $request, string $id): JsonResponse
    {
        $coupon = Coupon::query()->findOrFail($id);
        $coupon->update($request->validated());

        return ApiResponse::ok($coupon, 'Coupon updated');
    }

    public function destroy(string $id): JsonResponse
    {
        Coupon::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Coupon deleted');
    }

    /** Preview a coupon's discount for a subtotal (POS / checkout). */
    public function validateCode(Request $request, CouponService $coupons, TenantContext $context): JsonResponse
    {
        $data = $request->validate([
            'code' => ['required', 'string'],
            'subtotal' => ['required', 'numeric', 'min:0'],
        ]);

        $result = $coupons->validate($context->id(), $data['code'], (float) $data['subtotal']);

        return ApiResponse::ok([
            'code' => $result['coupon']->code,
            'type' => $result['coupon']->type,
            'value' => $result['coupon']->value,
            'discount' => $result['discount'],
        ]);
    }
}
