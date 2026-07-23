<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Enums\PaymentMethod;
use App\Http\Controllers\Controller;
use App\Models\Reservation;
use App\Services\ReservationService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ReservationController extends Controller
{
    public function index(Request $request, ReservationService $service): JsonResponse
    {
        // Lazy sweep keeps statuses honest even between scheduler runs.
        $service->expireOverdue();

        $reservations = Reservation::query()
            ->with('customer:id,name,phone')
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', $status))
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated($reservations);
    }

    public function accept(string $id, ReservationService $service): JsonResponse
    {
        $reservation = $service->accept(Reservation::query()->findOrFail($id));

        return ApiResponse::ok($reservation, 'Reservation accepted — stock is on hold');
    }

    public function reject(Request $request, string $id, ReservationService $service): JsonResponse
    {
        $request->validate(['reason' => ['nullable', 'string', 'max:255']]);

        $reservation = $service->reject(
            Reservation::query()->findOrFail($id),
            $request->input('reason'),
        );

        return ApiResponse::ok($reservation, 'Reservation rejected');
    }

    public function complete(Request $request, string $id, ReservationService $service): JsonResponse
    {
        $payment = $request->validate([
            'payment_method' => ['required', Rule::enum(PaymentMethod::class)],
            'amount_paid' => ['required', 'numeric', 'min:0'],
        ]);

        $reservation = $service->complete(Reservation::query()->findOrFail($id), $payment);

        return ApiResponse::ok($reservation, "Sale {$reservation->sale?->invoice_number} completed");
    }
}
