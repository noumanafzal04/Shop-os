<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Staff\CreateStaffAction;
use App\Actions\Staff\DeleteStaffAction;
use App\Actions\Staff\UpdateStaffAction;
use App\Enums\UserRole;
use App\Http\Controllers\Controller;
use App\Http\Requests\Staff\StoreTenantStaffRequest;
use App\Http\Requests\Staff\UpdateStaffRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Support\ApiResponse;
use App\Support\Permissions;
use App\Support\StaffPresets;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Tenant staff management — shop side. The shop owner (or staff holding
 * staff.manage) can only ever see and manage staff of their OWN tenant:
 * the tenant id comes from the resolved context, never from input.
 */
class StaffController extends Controller
{
    public function __construct(private readonly TenantContext $context) {}

    public function index(Request $request): JsonResponse
    {
        $staff = User::query()
            ->where('role', UserRole::Staff)
            ->where('tenant_id', $this->context->id())
            ->when($request->query('search'), function ($q, $search): void {
                $q->where(function ($q) use ($search): void {
                    $q->where('name', 'like', "%{$search}%")
                        ->orWhere('email', 'like', "%{$search}%")
                        ->orWhere('phone', 'like', "%{$search}%");
                });
            })
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', $status))
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated(UserResource::collection($staff));
    }

    public function store(StoreTenantStaffRequest $request, CreateStaffAction $action): JsonResponse
    {
        $staff = $action->execute(
            actor: $request->user(),
            data: $request->validated(),
            role: UserRole::Staff,
            tenantId: $this->context->id(),
        );

        return ApiResponse::created(new UserResource($staff));
    }

    public function show(string $id): JsonResponse
    {
        return ApiResponse::ok(new UserResource($this->findStaff($id)));
    }

    public function update(UpdateStaffRequest $request, string $id, UpdateStaffAction $action): JsonResponse
    {
        $staff = $action->execute($request->user(), $this->findStaff($id), $request->validated());

        return ApiResponse::ok(new UserResource($staff), 'Staff updated');
    }

    public function destroy(Request $request, string $id, DeleteStaffAction $action): JsonResponse
    {
        $action->execute($request->user(), $this->findStaff($id));

        return ApiResponse::noContent('Staff deleted');
    }

    public function permissions(): JsonResponse
    {
        return ApiResponse::ok(Permissions::tenant());
    }

    /**
     * "What job does this person do?" — the jobs worth offering THIS shop.
     *
     * Filtered by the modules the tenant was granted and, where a job exists in
     * only one trade, by the trade: offering "Waiter" to a pharmacy is noise,
     * and noise on a permission screen is how the wrong box gets ticked.
     *
     * Nothing here is stored against a user. A preset ticks boxes and is
     * forgotten — see StaffPresets.
     */
    public function presets(): JsonResponse
    {
        return ApiResponse::ok(StaffPresets::for($this->context->get()));
    }

    private function findStaff(string $id): User
    {
        // Scoped to own tenant + staff role only: cross-tenant access or
        // editing the owner through this endpoint is impossible.
        return User::query()
            ->where('role', UserRole::Staff)
            ->where('tenant_id', $this->context->id())
            ->findOrFail($id);
    }
}
