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

    /**
     * THE SHOP'S PEOPLE.
     *
     * `status` has been accepted since this was written and the screen sent a
     * search box, so an owner could not ask the one question a staff list is
     * opened with after somebody leaves: who is still switched on.
     *
     * `branch` and `job` are new. Which branch somebody works in decides which
     * stock they ring against, and what job they do is the word an owner
     * actually thinks in — nobody looks for "the people holding sales.void".
     */
    public function index(Request $request): JsonResponse
    {
        $mine = fn () => User::query()
            ->where('role', UserRole::Staff)
            ->where('tenant_id', $this->context->id());

        $staff = $mine()
            ->when($request->query('search'), function ($q, $search): void {
                $q->where(function ($q) use ($search): void {
                    $q->where('name', 'like', "%{$search}%")
                        ->orWhere('email', 'like', "%{$search}%")
                        ->orWhere('phone', 'like', "%{$search}%");
                });
            })
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', $status))
            // Where they work. "Main" is spelled out rather than left as the
            // absence of a value, because a shop with three branches has
            // people pinned to each and people pinned to none, and those are
            // different answers.
            ->when($request->query('branch_id') === 'none', fn ($q) => $q->whereNull('branch_id'))
            ->when(
                $request->query('branch_id') && $request->query('branch_id') !== 'none',
                fn ($q) => $q->where('branch_id', $request->query('branch_id')),
            )
            ->when($request->query('permission'), fn ($q, $key) => $q->whereJsonContains('permissions', $key))
            ->when($request->query('job'), fn ($q, $job) => $q->whereIn('id', $this->doingTheJob($job)))
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated(UserResource::collection($staff));
    }

    /**
     * The ids of people whose permissions are EXACTLY that job.
     *
     * Worked out in PHP rather than in SQL, and deliberately: the rule is
     * StaffPresets::isJob — a set comparison, order and duplicates
     * meaningless — and expressing that over a JSON column means
     * `JSON_LENGTH` on MySQL and `json_array_length` on SQLite, two dialects
     * of one question with nothing to check the second against.
     *
     * The bound that makes this safe is the shop itself: staff are capped per
     * tenant by an assigned limit, so this reads tens of rows and never
     * thousands. If that ever stops being true, the fix is a stored job
     * column, not a cleverer query — and it would need a migration, which is
     * the right amount of friction for a decision like that.
     *
     * @return array<int, string>
     */
    private function doingTheJob(string $job): array
    {
        return User::query()
            ->where('role', UserRole::Staff)
            ->where('tenant_id', $this->context->id())
            ->get(['id', 'permissions'])
            ->filter(fn (User $user): bool => StaffPresets::isJob($job, $user->permissions ?? []))
            ->pluck('id')
            ->all();
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

    /**
     * The permission checkboxes, each saying whether THIS shop can use it.
     *
     * The presets directly above this list have been filtered by the shop's
     * modules and trade since they were written. The checkboxes never were, so
     * a mart hiring a cashier was offered Kitchen board, Serve any table and
     * Reservations — three boxes granting access to screens that shop does not
     * have. One rule, applied to the presets and not to the thing they tick.
     *
     * Irrelevant rows are FLAGGED, not dropped: see the note on
     * Permissions::tenantCatalogFor for why removing them from the payload
     * would silently revoke a permission somebody still holds.
     */
    public function permissions(): JsonResponse
    {
        return ApiResponse::ok(Permissions::tenantCatalogFor($this->context->get()));
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
