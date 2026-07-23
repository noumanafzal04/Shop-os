<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Services\DashboardService;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;

class DashboardController extends Controller
{
    public function index(TenantContext $context, DashboardService $service): JsonResponse
    {
        return ApiResponse::ok($service->forTenant($context->get()));
    }
}
