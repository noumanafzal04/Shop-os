<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Fuel\ChangeFuelPriceAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Fuel\StoreFuelPriceRequest;
use App\Models\FuelPriceChange;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** The price-notification log. Append-only — a history that can be edited isn't one. */
class FuelPriceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $changes = FuelPriceChange::query()
            ->with(['product:id,name', 'changedBy:id,name'])
            ->when($request->filled('product_id'), fn ($q) => $q->where('product_id', $request->string('product_id')))
            ->orderByDesc('effective_at')
            ->paginate(30);

        return ApiResponse::paginated($changes);
    }

    public function store(StoreFuelPriceRequest $request, ChangeFuelPriceAction $action): JsonResponse
    {
        $change = $action->execute($request->user(), $request->validated());

        return ApiResponse::created($change, 'Rate updated');
    }
}
