<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Services\DashboardService;
use App\Support\ApiResponse;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    /**
     * The platform's landing screen, which stays reachable by every platform
     * role — it is where /admin lands, and a home page that 403s is not a
     * permission model, it is a locked front door.
     *
     * What it CONTAINS still follows the permission list: the revenue figures
     * and the payment ledger are withheld from staff without `billing.view`,
     * the same as the billing endpoints they are drawn from. Withholding them
     * here matters more than it looks — a screen that quietly shows the number
     * an endpoint refuses is the endpoint's gate being decorative.
     */
    public function index(Request $request, DashboardService $service): JsonResponse
    {
        return ApiResponse::ok($service->forPlatform(
            withRevenue: $request->user()->hasPermission(Permissions::BILLING_VIEW),
        ));
    }
}
