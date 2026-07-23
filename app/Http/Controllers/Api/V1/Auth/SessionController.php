<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Controllers\Controller;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SessionController extends Controller
{
    /**
     * List active devices (access tokens only; refresh pairs are internal).
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $currentId = $user->currentAccessToken()?->id;

        $sessions = $user->tokens()
            ->where('name', 'not like', '%:refresh')
            ->orderByDesc('last_used_at')
            ->get()
            ->map(fn ($token) => [
                'id' => (string) $token->id,
                'device_name' => $token->name,
                'last_used_at' => $token->last_used_at?->toIso8601String(),
                'created_at' => $token->created_at?->toIso8601String(),
                'expires_at' => $token->expires_at?->toIso8601String(),
                'is_current' => $token->id === $currentId,
            ]);

        return ApiResponse::ok($sessions);
    }

    /**
     * Revoke one device (its refresh pair dies with it).
     */
    public function destroy(Request $request, string $tokenId): JsonResponse
    {
        $user = $request->user();

        $token = $user->tokens()->where('id', $tokenId)->first();

        if ($token === null) {
            return ApiResponse::notFound('Session not found.');
        }

        $user->tokens()
            ->whereIn('name', [$token->name, $token->name.':refresh'])
            ->delete();

        return ApiResponse::ok(null, 'Session revoked');
    }
}
