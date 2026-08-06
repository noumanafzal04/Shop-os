<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Fuel\RecordFuelDeliveryAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Fuel\StoreFuelDeliveryRequest;
use App\Models\FuelDelivery;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Tankers in. See RecordFuelDeliveryAction for why invoiced and received are kept apart. */
class FuelDeliveryController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $deliveries = FuelDelivery::query()
            ->with(['tank:id,name', 'supplier:id,name', 'shift:id,number', 'receivedBy:id,name'])
            ->when($request->filled('fuel_tank_id'), fn ($q) => $q->where('fuel_tank_id', $request->string('fuel_tank_id')))
            ->when($request->filled('from'), fn ($q) => $q->whereDate('received_at', '>=', $request->date('from')))
            ->when($request->filled('to'), fn ($q) => $q->whereDate('received_at', '<=', $request->date('to')))
            ->orderByDesc('received_at')
            ->paginate(20);

        return ApiResponse::paginated($deliveries);
    }

    public function store(StoreFuelDeliveryRequest $request, RecordFuelDeliveryAction $action): JsonResponse
    {
        $delivery = $action->execute($request->user(), $request->validated());

        $short = (float) $delivery->shortage_litres;

        return ApiResponse::created(
            $delivery,
            $short > 0
                ? "Delivery recorded — {$short} litres short of the invoice"
                : 'Delivery recorded',
        );
    }
}
