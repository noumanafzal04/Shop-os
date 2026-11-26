<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Support\ApiResponse;
use App\Support\PlatformSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * DELIVERY & FEES — the market's rules, set once for every shop that has not
 * set its own: the least a delivery basket may be and what happens below it,
 * the per-km fee, the platform's service fee, the rain-or-rush fee, how long
 * a shop has to accept, and how much cash a pool rider may carry.
 */
class DeliveryRulesController extends Controller
{
    public function show(): JsonResponse
    {
        return ApiResponse::ok($this->current());
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate(PlatformSettings::deliveryRules());

        PlatformSettings::put($data, $request->user()->id);

        return ApiResponse::ok($this->current(), 'Delivery rules saved');
    }

    /** @return array<string, mixed> */
    private function current(): array
    {
        $all = PlatformSettings::all();

        return array_intersect_key($all, PlatformSettings::deliveryRules());
    }
}
