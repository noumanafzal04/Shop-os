<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Services\DashboardService;
use App\Support\ApiResponse;
use App\Support\DashboardPeriod;
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
        // `from` and `to` name the period asked about — see DashboardPeriod.
        $asked = $request->validate(DashboardPeriod::rules());

        $user = $request->user();
        $data = $service->forPlatform(
            withRevenue: $user->hasPermission(Permissions::BILLING_VIEW),
            from: $asked['from'] ?? null,
            to: $asked['to'] ?? null,
        );

        // The same rule for what is not money (next rounds #27): five shops by
        // name went to a banners-only hand who is 403 on /admin/tenants, and the
        // platform audit feed to one who may not open /admin/audit-logs. Absent,
        // as the revenue is — the screen draws no panel for what never arrived.
        if (! $user->hasPermission(Permissions::TENANTS_VIEW)) {
            unset($data['recent_tenants']);
        }
        if (! $user->isSuperAdmin()) {
            unset($data['activity']);
        }

        return ApiResponse::ok($data);
    }
}
