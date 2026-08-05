<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hardware\StoreHardwareDeviceRequest;
use App\Http\Requests\Hardware\UpdateHardwareDeviceRequest;
use App\Models\HardwareDevice;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * Hardware registry CRUD — the shop's peripherals as configuration. Only one
 * device per type may be the default (the one the POS reaches first).
 */
class HardwareDeviceController extends Controller
{
    public function index(): JsonResponse
    {
        $devices = HardwareDevice::query()
            ->with('register:id,name,code')
            ->orderByDesc('is_default')
            ->orderBy('type')
            ->orderBy('name')
            ->get();

        return ApiResponse::ok($devices);
    }

    public function store(StoreHardwareDeviceRequest $request): JsonResponse
    {
        $data = $request->validated();
        $device = HardwareDevice::create($data);
        $this->keepSingleDefault($device);

        return ApiResponse::created($device->refresh(), 'Device added');
    }

    public function update(UpdateHardwareDeviceRequest $request, string $id): JsonResponse
    {
        $device = HardwareDevice::query()->findOrFail($id);
        $device->fill($request->validated())->save();
        $this->keepSingleDefault($device);

        return ApiResponse::ok($device->refresh(), 'Device updated');
    }

    public function destroy(string $id): JsonResponse
    {
        HardwareDevice::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Device removed');
    }

    /**
     * At most one default per type PER LANE.
     *
     * This used to clear the flag tenant-wide, which quietly made a six-lane
     * mart impossible: marking lane 2's printer default un-defaulted lane 1's,
     * so every checkout ended up reaching for the same machine. The scope that
     * matters is the terminal — lane 2's default printer and lane 5's default
     * printer are both correct at the same time. Shop-wide devices
     * (register_id null) remain their own single-default group, the fallback
     * for any lane with no hardware of its own.
     */
    private function keepSingleDefault(HardwareDevice $device): void
    {
        if (! $device->is_default) {
            return;
        }

        HardwareDevice::query()
            ->where('type', $device->type)
            ->when(
                $device->register_id === null,
                fn ($q) => $q->whereNull('register_id'),
                fn ($q) => $q->where('register_id', $device->register_id),
            )
            ->whereKeyNot($device->id)
            ->update(['is_default' => false]);
    }
}
