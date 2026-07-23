<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Actions\Auth\ResetPasswordAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\ResetPasswordRequest;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

class PasswordController extends Controller
{
    /**
     * Single call: identifier + OTP code + new password. The code is
     * consumed atomically — reset tokens can never be replayed.
     */
    public function reset(ResetPasswordRequest $request, ResetPasswordAction $action): JsonResponse
    {
        $action->execute(
            identifier: $request->validated('identifier'),
            code: $request->validated('code'),
            password: $request->validated('password'),
        );

        return ApiResponse::ok(null, 'Password has been reset. Please log in.');
    }
}
