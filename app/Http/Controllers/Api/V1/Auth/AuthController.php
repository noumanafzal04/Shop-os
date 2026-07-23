<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Actions\Auth\ChangePasswordAction;
use App\Actions\Auth\LoginAction;
use App\Actions\Auth\OtpLoginAction;
use App\Actions\Auth\RefreshTokenAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\ChangePasswordRequest;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\OtpLoginRequest;
use App\Http\Resources\UserResource;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuthController extends Controller
{
    public function login(LoginRequest $request, LoginAction $action): JsonResponse
    {
        $result = $action->execute(
            identifier: $request->validated('identifier'),
            password: $request->validated('password'),
            deviceName: $request->validated('device_name', 'api'),
        );

        return ApiResponse::ok([
            'user' => (new UserResource($result['user']->load('tenant.city', 'tenant.plan')))->resolve(),
            ...$result['tokens'],
        ], 'Logged in');
    }

    public function otpLogin(OtpLoginRequest $request, OtpLoginAction $action): JsonResponse
    {
        $result = $action->execute(
            identifier: $request->validated('identifier'),
            code: $request->validated('code'),
            deviceName: $request->validated('device_name', 'api'),
        );

        return ApiResponse::ok([
            'user' => (new UserResource($result['user']->load('tenant.city', 'tenant.plan')))->resolve(),
            ...$result['tokens'],
        ], 'Logged in');
    }

    public function refresh(Request $request, RefreshTokenAction $action): JsonResponse
    {
        return ApiResponse::ok($action->execute($request->user()), 'Token refreshed');
    }

    public function me(Request $request): JsonResponse
    {
        return ApiResponse::ok(
            new UserResource($request->user()->load('tenant.city', 'tenant.plan')),
        );
    }

    public function changePassword(ChangePasswordRequest $request, ChangePasswordAction $action): JsonResponse
    {
        $action->execute(
            user: $request->user(),
            currentPassword: $request->validated('current_password'),
            newPassword: $request->validated('password'),
        );

        return ApiResponse::ok(null, 'Password changed. Other sessions have been logged out.');
    }

    public function logout(Request $request): JsonResponse
    {
        $user = $request->user();
        $current = $user->currentAccessToken();

        // Kill this device's access token and its paired refresh token.
        $user->tokens()
            ->whereIn('name', [$current->name, $current->name.':refresh'])
            ->delete();

        return ApiResponse::ok(null, 'Logged out');
    }

    public function logoutAll(Request $request): JsonResponse
    {
        $request->user()->tokens()->delete();

        return ApiResponse::ok(null, 'Logged out from all devices');
    }
}
