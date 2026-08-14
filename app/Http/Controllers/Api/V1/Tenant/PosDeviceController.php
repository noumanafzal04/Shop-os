<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Pos\RegisterDeviceRequest;
use App\Models\PosDevice;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\PlanLimits;
use App\Support\RegisterContext;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * The tills a shop actually runs on.
 *
 * Two audiences, as with registers. A CASHIER's browser announces itself on
 * every boot so the shop can see it and so `last_seen_at` — the clock the
 * offline policy reads — stays current. An OWNER lists them and revokes the one
 * that went missing.
 *
 * The device id is minted by the client and sent unchanged forever, which makes
 * registration idempotent with no round trip to ask "do you already know me".
 * It identifies a device; it does not yet authorise one. Every route here still
 * sits behind Sanctum, and the id becomes a credential only when offline
 * selling needs a device to prove itself with no user session behind it.
 */
class PosDeviceController extends Controller
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchContext $branch,
        private readonly RegisterContext $terminal,
    ) {}

    /**
     * Register this device, or touch the one already known by that id.
     *
     * Called on every boot, not only the first — the touch is the point. A
     * device that stops calling is a device that has gone offline, and how long
     * ago it last called is the whole of the offline policy.
     */
    public function store(RegisterDeviceRequest $request): JsonResponse
    {
        $tenantId = $this->tenant->id();
        $id = $request->validated('device_id');

        $device = PosDevice::query()->find($id);

        // A known id from a DIFFERENT shop is not a device we may touch. The
        // tenant scope already hides it, so this is about the id colliding
        // across tenants rather than about leaking anything — refuse rather
        // than silently minting a second row on the same primary key.
        if ($device === null && PosDevice::withoutTenancy()->whereKey($id)->exists()) {
            throw DomainException::conflict(
                'That device is registered to another shop.',
                'DEVICE_TAKEN',
            );
        }

        if ($device !== null && $device->isRevoked()) {
            throw DomainException::conflict(
                'This till was signed out by the shop owner. Ask them to allow it again.',
                'DEVICE_REVOKED',
            );
        }

        if ($device === null) {
            $device = new PosDevice;
            $device->id = $id;                      // client-minted; see the model
            $device->tenant_id = $tenantId;
        }

        $device->fill([
            // The lane and branch a till is standing at can change between
            // boots, so they are refreshed rather than set once.
            'branch_id' => $this->branch->id(),
            'register_id' => $this->terminal->id(),
            'user_agent' => substr((string) $request->userAgent(), 0, 400),
            'platform' => $request->validated('platform') ?? 'web',
        ]);

        // Only overwrite a name the shop gave it if a new one was actually
        // sent — a boot with no name must not blank "Counter tablet".
        if (($name = $request->validated('name')) !== null) {
            $device->name = $name;
        }

        // What this till has done with the offline engine so far. Stored as
        // sent rather than added to what is already there: a boot that never
        // got its acknowledgement is re-sent, and an increment would inflate
        // the exact number the offline decision turns on. See the migration for
        // why a WIPED till dropping back to zero is the safe half of that.
        if (($shadow = $request->validated('shadow')) !== null) {
            $device->fill([
                'shadow_checked' => $shadow['checked'],
                'shadow_matched' => $shadow['matched'],
                'shadow_skipped' => $shadow['skipped'],
                'shadow_differed' => $shadow['differed'],
                'shadow_since' => $shadow['since'],
            ]);
        }

        $device->last_seen_at = now();
        $device->save();

        return ApiResponse::ok($this->shape($device->fresh()), 'Device registered');
    }

    /** Every till this shop runs on, worst-out-of-contact first. */
    public function index(): JsonResponse
    {
        $devices = PosDevice::query()
            ->with(['branch:id,name', 'register:id,name'])
            ->orderByRaw('last_seen_at is null desc')
            ->orderBy('last_seen_at')
            ->get();

        return ApiResponse::ok([
            'devices' => $devices->map(fn (PosDevice $d): array => $this->shape($d))->values(),
            // The ceiling this shop was given, so the till knows what to
            // degrade against without a second call.
            'offline_days' => PlanLimits::limit($this->tenant->get(), 'offline_days'),
        ]);
    }

    /**
     * Stop a till being used — the tablet that was lost, or the laptop that
     * left with someone.
     *
     * Not a delete. The sales this device already sent still point at it, and
     * the row is what an owner reads afterwards to work out what happened.
     */
    public function destroy(string $id): JsonResponse
    {
        $device = PosDevice::query()->findOrFail($id);

        if (! $device->isRevoked()) {
            $device->revoked_at = now();
            $device->revoked_by = auth()->id();
            $device->save();
        }

        return ApiResponse::ok($this->shape($device->fresh()), 'Till signed out');
    }

    /** Allow a revoked till back — the tablet turned up. */
    public function restore(string $id): JsonResponse
    {
        $device = PosDevice::query()->findOrFail($id);
        $device->revoked_at = null;
        $device->revoked_by = null;
        $device->save();

        return ApiResponse::ok($this->shape($device->fresh()), 'Till allowed again');
    }

    private function shape(PosDevice $device): array
    {
        return [
            'id' => $device->id,
            'name' => $device->name,
            'platform' => $device->platform,
            'branch' => $device->branch?->only(['id', 'name']),
            'register' => $device->register?->only(['id', 'name']),
            'last_seen_at' => $device->last_seen_at?->toIso8601String(),
            'days_offline' => $device->daysOffline(),
            'revoked' => $device->isRevoked(),
            'revoked_at' => $device->revoked_at?->toIso8601String(),
        ];
    }
}
