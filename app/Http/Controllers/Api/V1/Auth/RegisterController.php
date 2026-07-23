<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Actions\Auth\IssueTokensAction;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\RegisterCustomerRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

class RegisterController extends Controller
{
    /**
     * Public CUSTOMER registration (marketplace side). Business accounts are
     * only ever created by the Super Admin — this endpoint cannot create them.
     */
    public function store(RegisterCustomerRequest $request, IssueTokensAction $issueTokens): JsonResponse
    {
        $user = User::query()->create([
            'name' => $request->validated('name'),
            'email' => $request->validated('email'),
            'phone' => $request->validated('phone'),
            'password' => $request->validated('password'),
            'role' => UserRole::Customer,
            'status' => UserStatus::Active,
            'tenant_id' => null,
        ]);

        $tokens = $issueTokens->execute($user, $request->input('device_name', 'api'));

        return ApiResponse::created([
            'user' => (new UserResource($user))->resolve(),
            ...$tokens,
        ], 'Welcome to ShopOS!');
    }
}
