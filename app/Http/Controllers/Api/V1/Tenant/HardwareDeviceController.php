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
     * At most one default per type: when this device is the default, clear the
     * flag on every other device of the same type for the tenant.
     */
    private function keepSingleDefault(HardwareDevice $device): void
    {
        if (! $device->is_default) {
            return;
        }

        HardwareDevice::query()
            ->where('type', $device->type)
            ->whereKeyNot($device->id)
            ->update(['is_default' => false]);
    }
}
