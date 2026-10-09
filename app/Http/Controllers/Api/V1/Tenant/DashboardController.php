<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Services\DashboardService;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\DashboardPeriod;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    /**
     * `from` and `to` name the period the screen is asking about — see
     * DashboardPeriod. Sent with neither, this is the standing view it has
     * always been, which is what the phone app reads.
     */
    public function index(Request $request, TenantContext $context, BranchContext $branch, DashboardService $service): JsonResponse
    {
        $asked = $request->validate(DashboardPeriod::rules());

        // scopeId() = the chosen branch, or null for an owner's All-Branches view.
        return ApiResponse::ok($service->forTenant(
            $context->get(),
            $branch->scopeId(),
            $asked['from'] ?? null,
            $asked['to'] ?? null,
        ));
    }
}
