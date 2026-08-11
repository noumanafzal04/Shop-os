<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Staff\CreateStaffAction;
use App\Actions\Staff\DeleteStaffAction;
use App\Actions\Staff\UpdateStaffAction;
use App\Enums\UserRole;
use App\Http\Controllers\Controller;
use App\Http\Requests\Staff\StorePlatformStaffRequest;
use App\Http\Requests\Staff\UpdateStaffRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Support\ApiResponse;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Platform staff (admin_staff) management — Super Admin side.
 */
class StaffController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $staff = User::query()
            ->where('role', UserRole::AdminStaff)
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

    public function store(StorePlatformStaffRequest $request, CreateStaffAction $action): JsonResponse
    {
        $staff = $action->execute($request->user(), $request->validated(), UserRole::AdminStaff);

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
        // Key + label + hint, so the most dangerous box on the platform cannot
        // be offered to an admin with nothing but its slug for an explanation.
        return ApiResponse::ok(Permissions::describe(Permissions::platform()));
    }

    private function findStaff(string $id): User
    {
        // Only admin_staff records are reachable here — a shop owner or super
        // admin can never be edited/deleted through this endpoint.
        return User::query()
            ->where('role', UserRole::AdminStaff)
            ->findOrFail($id);
    }
}
