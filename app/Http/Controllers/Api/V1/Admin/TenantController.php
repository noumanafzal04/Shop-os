<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Tenant\ActivateTenantAction;
use App\Actions\Tenant\AssignPlanAction;
use App\Actions\Tenant\CreateTenantAction;
use App\Actions\Tenant\DeleteTenantAction;
use App\Actions\Tenant\SuspendTenantAction;
use App\Actions\Tenant\UpdateTenantAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ExtendTenantLimitsRequest;
use App\Http\Requests\Admin\UpdateTenantModulesRequest;
use App\Http\Requests\Tenant\AssignPlanRequest;
use App\Http\Requests\Tenant\StoreTenantRequest;
use App\Http\Requests\Tenant\UpdateTenantRequest;
use App\Http\Resources\TenantResource;
use App\Models\Plan;
use App\Models\Tenant;
use App\Support\ApiResponse;
use App\Support\Modules;
use App\Support\PlanLimits;
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

    /**
     * Extend (or clear) a single tenant's plan limits. Sends a sparse map of
     * {limit_key: value|null}; null clears the override (back to the plan).
     * Most tenants share a common plan; this is how the odd one that needs more
     * gets it — without creating a bespoke plan.
     *
     * Two things here are load-bearing:
     *
     *  - `mode: add` treats the number as an INCREASE. Extending a
     *    1,000-product tenant by 100 means typing 100, not 1,100. The endpoint
     *    used to be set-only behind a button labelled "Extend", so typing the
     *    increase silently cut the ceiling to it.
     *
     *  - A ceiling can never land BELOW what the tenant already uses. A shop
     *    with 800 products whose limit is cut to 100 isn't warned — it just
     *    finds that nothing can be added any more, which surfaces as "the
     *    software is broken" days later. Downgrading to a level the tenant has
     *    already grown past is always a mistake; refuse it with the numbers.
     */
    public function extendLimits(ExtendTenantLimitsRequest $request, string $id): JsonResponse
    {
        /** @var Tenant $tenant */
        $tenant = Tenant::query()->findOrFail($id)->loadMissing('plan');

        $mode = $request->validated('mode') ?? 'set';
        $overrides = $tenant->limit_overrides ?? [];
        $applied = [];

        foreach ($request->validated('limits') as $key => $value) {
            if ($value === null) {
                unset($overrides[$key]); // clear → fall back to the plan
                $applied[$key] = null;

                continue;
            }

            $current = PlanLimits::limit($tenant, $key);

            // Adding to "unlimited" is meaningless — there is no ceiling to
            // raise. Say so rather than quietly inventing one.
            if ($mode === 'add' && $current === null) {
                throw DomainException::unprocessable(
                    "{$key} is already unlimited for this tenant — there is nothing to extend.",
                    'ALREADY_UNLIMITED',
                );
            }

            $next = $mode === 'add' ? (int) $current + (int) $value : (int) $value;

            if ($next < 1) {
                throw DomainException::unprocessable(
                    "That would leave {$key} at {$next}. A limit has to be at least 1.",
                    'LIMIT_TOO_LOW',
                );
            }

            // The guard against a typo becoming an outage.
            $used = PlanLimits::usage($tenant, $key);
            if ($next < $used) {
                $label = PlanLimits::REGISTRY[$key]['label'];
                throw DomainException::unprocessable(
                    "This shop already has {$used} {$label} — the limit can't be set to {$next}. "
                    ."Set it to {$used} or more, or remove the extra {$label} first.",
                    'LIMIT_BELOW_USAGE',
                );
            }

            $overrides[$key] = $next;
            $applied[$key] = $next;
        }

        $tenant->forceFill(['limit_overrides' => $overrides ?: null])->save();

        return ApiResponse::ok(
            new TenantResource($tenant->fresh()->load('city', 'plan')),
            'Limits updated',
            ['applied' => $applied],
        );
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
