<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\Rider\StoreRiderRequest;
use App\Http\Requests\Rider\UpdateRiderRequest;
use App\Models\Rider;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A shop's own delivery riders (Model A). Tenant-scoped CRUD; a rider with
 * open deliveries can be deactivated but not left mid-order silently — see
 * the active-orders guard on destroy.
 */
class RiderController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $riders = Rider::query()
            ->when($request->has('is_active'), fn ($q) => $q->where('is_active', $request->boolean('is_active')))
            ->withCount(['orders as active_deliveries' => fn ($q) => $q->whereNotIn('status', ['completed', 'cancelled'])])
            ->orderBy('name')
            ->get();

        return ApiResponse::ok($riders);
    }

    public function store(StoreRiderRequest $request): JsonResponse
    {
        $rider = Rider::query()->create($request->validated() + ['created_by' => auth()->id()]);

        return ApiResponse::created($rider, 'Rider added');
    }

    public function update(UpdateRiderRequest $request, string $id): JsonResponse
    {
        $rider = Rider::query()->findOrFail($id);
        $rider->update($request->validated());

        return ApiResponse::ok($rider, 'Rider updated');
    }

    public function destroy(string $id): JsonResponse
    {
        $rider = Rider::query()->findOrFail($id);
        $rider->delete(); // soft delete — past orders keep their rider snapshot via the nullable FK

        return ApiResponse::noContent('Rider removed');
    }
}
