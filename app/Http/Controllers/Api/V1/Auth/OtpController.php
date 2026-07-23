<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Enums\OtpPurpose;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\RequestOtpRequest;
use App\Services\OtpService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

class OtpController extends Controller
{
    /**
     * Always responds 200 with the same message whether or not the account
     * exists — no user enumeration through this endpoint. Rate limited via
     * throttle:otp (1/min, 5/hour per IP).
     */
    public function request(RequestOtpRequest $request, OtpService $service): JsonResponse
    {
        $purpose = OtpPurpose::from($request->validated('purpose'));
        $identifier = $request->validated('identifier');

        $data = null;

        if ($purpose === OtpPurpose::Verification || $service->findUser($identifier) !== null) {
            $otp = $service->request($identifier, $purpose, $request->ip());

            if (config('app.debug')) {
                $data = ['debug_code' => $otp->getAttribute('debug_code')];
            }
        }

        return ApiResponse::ok($data, 'If the account exists, a code has been sent.');
    }
}
