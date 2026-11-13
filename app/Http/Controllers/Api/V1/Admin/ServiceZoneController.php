<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ServiceZoneRequest;
use App\Models\ServiceZone;
use App\Models\Tenant;
use App\Support\ApiResponse;
use App\Support\ServiceZones;
use Illuminate\Http\JsonResponse;

/**
 * WHERE THE PLATFORM SERVES — drawn by the admin.
 *
 * Every change asks every shop again whether its pin is inside (so the
 * marketplace filters on a column), and says how many online shops that
 * leaves outside: a zone drawn too tight hides shops the moment it is saved,
 * and the person drawing it should see that number before anybody calls.
 */
class ServiceZoneController extends Controller
{
    public function index(): JsonResponse
    {
        return ApiResponse::ok([
            'zones' => ServiceZone::query()->with('city:id,name')->orderBy('name')->get(),
            'summary' => $this->summary(),
            // Every online shop's pin, so the map shows what a zone covers and
            // what it leaves out while it is being drawn.
            'shops' => Tenant::query()->where('online_shop_enabled', true)->where('setup_completed', true)
                ->whereNotNull('latitude')->whereNotNull('longitude')
                ->orderBy('business_name')->limit(5000)
                ->get(['id', 'business_name', 'latitude', 'longitude', 'in_service_zone']),
        ]);
    }

    public function store(ServiceZoneRequest $request): JsonResponse
    {
        $zone = ServiceZone::query()->create($request->zone());
        ServiceZones::changed();

        return ApiResponse::created(['zone' => $zone->load('city:id,name'), 'summary' => $this->summary()], "Zone \"{$zone->name}\" saved");
    }

    public function update(ServiceZoneRequest $request, string $id): JsonResponse
    {
        $zone = ServiceZone::query()->findOrFail($id);
        $zone->fill($request->zone())->save();
        ServiceZones::changed();

        return ApiResponse::ok(['zone' => $zone->load('city:id,name'), 'summary' => $this->summary()], 'Zone saved');
    }

    public function destroy(string $id): JsonResponse
    {
        $zone = ServiceZone::query()->findOrFail($id);
        $zone->delete();
        ServiceZones::changed();

        return ApiResponse::ok(['summary' => $this->summary()], 'Zone removed');
    }

    /** @return array{zones_active: int, online_shops: int, online_shops_outside: int} */
    private function summary(): array
    {
        $online = Tenant::query()->where('online_shop_enabled', true)->where('setup_completed', true);
        $active = ServiceZone::query()->active()->count();

        return [
            'zones_active' => $active,
            'online_shops' => (clone $online)->count(),
            // With nothing drawn nothing is fenced, so nothing is outside.
            'online_shops_outside' => $active === 0 ? 0 : (clone $online)->where('in_service_zone', false)->count(),
        ];
    }
}
