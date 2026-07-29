<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Services\DashboardService;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;

class DashboardController extends Controller
{
    public function index(TenantContext $context, BranchContext $branch, DashboardService $service): JsonResponse
    {
        // scopeId() = the chosen branch, or null for an owner's All-Branches view.
        return ApiResponse::ok($service->forTenant($context->get(), $branch->scopeId()));
    }
}
