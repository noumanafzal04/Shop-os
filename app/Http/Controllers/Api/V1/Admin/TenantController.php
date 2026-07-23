<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Tenant\ActivateTenantAction;
use App\Actions\Tenant\AssignPlanAction;
use App\Actions\Tenant\CreateTenantAction;
use App\Actions\Tenant\DeleteTenantAction;
use App\Actions\Tenant\SuspendTenantAction;
use App\Actions\Tenant\UpdateTenantAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\UpdateTenantModulesRequest;
use App\Http\Requests\Tenant\AssignPlanRequest;
use App\Http\Requests\Tenant\StoreTenantRequest;
use App\Http\Requests\Tenant\UpdateTenantRequest;
use App\Http\Resources\TenantResource;
use App\Models\Plan;
use App\Models\Tenant;
use App\Support\ApiResponse;
use App\Support\Modules;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TenantController extends Controller
{
    /**
     * List tenants — paginated, searchable, filterable.
     */
    public function index(Request $request): JsonResponse
    {
        $tenants = Tenant::query()
            ->with(['city', 'plan'])
            ->when($request->query('search'), function ($q, $search): void {
                $q->where(function ($q) use ($search): void {
                    $q->where('business_name', 'like', "%{$search}%")
                        ->orWhere('email', 'like', "%{$search}%")
                        ->orWhere('phone', 'like', "%{$search}%");
                });
            })
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', $status))
            ->when($request->query('city_id'), fn ($q, $cityId) => $q->where('city_id', $cityId))
            ->when($request->query('plan_id'), fn ($q, $planId) => $q->where('plan_id', $planId))
            ->when($request->boolean('online_only'), fn ($q) => $q->where('online_shop_enabled', true))
            ->when($request->boolean('with_deleted'), fn ($q) => $q->withTrashed())
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated(TenantResource::collection($tenants));
    }

    public function store(StoreTenantRequest $request, CreateTenantAction $action): JsonResponse
    {
        $tenant = $action->execute($request->validated());

        return ApiResponse::created(new TenantResource($tenant));
    }

    public function show(string $id): JsonResponse
    {
        $tenant = Tenant::withTrashed()->with(['city', 'plan', 'users'])->findOrFail($id);

        return ApiResponse::ok(new TenantResource($tenant));
    }

    public function update(UpdateTenantRequest $request, string $id, UpdateTenantAction $action): JsonResponse
    {
        $tenant = $action->execute(Tenant::query()->findOrFail($id), $request->validated());

        return ApiResponse::ok(new TenantResource($tenant), 'Tenant updated');
    }

    public function destroy(string $id, DeleteTenantAction $action): JsonResponse
    {
        $action->execute(Tenant::query()->findOrFail($id));

        return ApiResponse::noContent('Tenant deleted');
    }

    /** The catalog of manageable modules (labels + descriptions). */
    public function moduleCatalog(): JsonResponse
    {
        return ApiResponse::ok(
            collect(Modules::all())->map(fn ($m, $key) => ['key' => $key] + $m)->values(),
        );
    }

    /** Toggle a tenant's enabled modules (its feature flags). */
    public function updateModules(UpdateTenantModulesRequest $request, string $id): JsonResponse
    {
        /** @var Tenant $tenant */
        $tenant = Tenant::query()->findOrFail($id);

        // Merge only known keys over the current feature map.
        $features = array_merge(
            $tenant->features ?? [],
            collect($request->validated('modules'))
                ->only(Modules::keys())
                ->map(fn ($v) => (bool) $v)
                ->all(),
        );

        $tenant->forceFill(['features' => $features])->save();

        return ApiResponse::ok(new TenantResource($tenant->fresh()->load('city', 'plan')), 'Modules updated');
    }

    public function suspend(string $id, SuspendTenantAction $action): JsonResponse
    {
        $tenant = $action->execute(Tenant::query()->findOrFail($id));

        return ApiResponse::ok(new TenantResource($tenant), 'Tenant suspended — all sessions revoked');
    }

    public function activate(string $id, ActivateTenantAction $action): JsonResponse
    {
        $tenant = $action->execute(Tenant::query()->findOrFail($id));

        return ApiResponse::ok(new TenantResource($tenant), 'Tenant activated');
    }

    public function restore(string $id): JsonResponse
    {
        $tenant = Tenant::withTrashed()->findOrFail($id);

        if (! $tenant->trashed()) {
            return ApiResponse::error('This tenant is not deleted.', 409, code: 'TENANT_NOT_DELETED');
        }

        $tenant->restore();

        return ApiResponse::ok(new TenantResource($tenant), 'Tenant restored');
    }

    public function assignPlan(AssignPlanRequest $request, string $id, AssignPlanAction $action): JsonResponse
    {
        $tenant = $action->execute(
            Tenant::query()->findOrFail($id),
            Plan::query()->findOrFail($request->validated('plan_id')),
            $request->validated('payment'),
        );

        return ApiResponse::ok(new TenantResource($tenant), 'Plan assigned');
    }
}
