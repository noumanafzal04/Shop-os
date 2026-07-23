<?php

namespace App\Http\Controllers\Api\V1\Marketplace;

use App\Http\Controllers\Controller;
use App\Models\Reservation;
use App\Models\Tenant;
use App\Services\ReservationService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CustomerReservationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $reservations = Reservation::withoutTenancy()
            ->where('customer_id', $request->user()->id)
            ->with('tenant:id,business_name,slug')
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 15), 100))
            ->through(fn (Reservation $r) => [
                'id' => $r->id,
                'shop' => [
                    'slug' => $r->tenant?->slug,
                    'business_name' => $r->tenant?->business_name,
                ],
                'product_name' => $r->product_name,
                'variant_name' => $r->variant_name,
                'quantity' => $r->quantity,
                'unit_price' => $r->unit_price,
                'status' => $r->status,
                'expires_at' => $r->expires_at?->toIso8601String(),
                'created_at' => $r->created_at?->toIso8601String(),
            ]);

        return ApiResponse::paginated($reservations);
    }

    public function store(Request $request, ReservationService $service): JsonResponse
    {
        $data = $request->validate([
            'shop_slug' => ['required', 'string'],
            'product_id' => ['required', 'uuid'],
            'variant_id' => ['nullable', 'uuid'],
            'quantity' => ['required', 'integer', 'min:1', 'max:100'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);

        $shop = Tenant::query()
            ->marketplaceVisible()
            ->where('slug', $data['shop_slug'])
            ->firstOrFail();

        $reservation = $service->create($request->user(), $shop, $data);

        return ApiResponse::created($reservation, 'Reservation requested — the shop will confirm shortly.');
    }

    public function cancel(Request $request, string $id, ReservationService $service): JsonResponse
    {
        $reservation = Reservation::withoutTenancy()
            ->where('customer_id', $request->user()->id)
            ->findOrFail($id);

        return ApiResponse::ok($service->cancelByCustomer($reservation), 'Reservation cancelled');
    }
}
