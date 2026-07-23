<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\DeviceToken;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Push-token registration for the mobile app. A token is unique to a device;
 * registering it re-points it at the current user (device handed over / login
 * switch), so it never notifies the wrong person.
 */
class DeviceController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string', 'max:512'],
            'platform' => ['sometimes', Rule::in(['android', 'ios', 'web'])],
        ]);

        DeviceToken::query()->updateOrCreate(
            ['token' => $data['token']],
            [
                'user_id' => $request->user()->id,
                'platform' => $data['platform'] ?? 'android',
                'last_used_at' => now(),
            ],
        );

        return ApiResponse::ok(null, 'Device registered');
    }

    public function destroy(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string']]);

        DeviceToken::query()
            ->where('token', $data['token'])
            ->where('user_id', $request->user()->id)
            ->delete();

        return ApiResponse::noContent('Device removed');
    }
}
