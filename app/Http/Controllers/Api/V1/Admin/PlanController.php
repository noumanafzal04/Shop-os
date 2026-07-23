<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Plan\StorePlanRequest;
use App\Http\Requests\Plan\UpdatePlanRequest;
use App\Http\Resources\PlanResource;
use App\Models\Plan;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

class PlanController extends Controller
{
    /**
     * Readable by any platform role (assign-plan dropdowns need it);
     * writes below are Super-Admin only (enforced in the FormRequests).
     */
    public function index(): JsonResponse
    {
        return ApiResponse::ok(
            PlanResource::collection(
                Plan::query()->withCount('tenants')->orderBy('price')->get(),
            ),
        );
    }

    public function store(StorePlanRequest $request): JsonResponse
    {
        $plan = Plan::query()->create($request->validated());

        return ApiResponse::created(new PlanResource($plan));
    }

    public function update(UpdatePlanRequest $request, string $id): JsonResponse
    {
        $plan = Plan::query()->findOrFail($id);
        $plan->fill($request->validated())->save();

        return ApiResponse::ok(new PlanResource($plan->loadCount('tenants')), 'Plan updated');
    }

    /**
     * Delete only if no tenant references it — otherwise deactivate instead,
     * so historical assignments/payments keep their plan.
     */
    public function destroy(string $id): JsonResponse
    {
        $plan = Plan::query()->withCount('tenants')->findOrFail($id);

        if ($plan->tenants_count > 0) {
            return ApiResponse::error(
                "This plan is assigned to {$plan->tenants_count} tenant(s). Deactivate it instead of deleting.",
                409,
                code: 'PLAN_IN_USE',
            );
        }

        $plan->delete();

        return ApiResponse::noContent('Plan deleted');
    }
}
