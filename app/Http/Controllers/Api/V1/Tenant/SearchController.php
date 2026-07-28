<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Services\GlobalSearchService;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SearchController extends Controller
{
    /**
     * Global search — one query across products, customers, sales, orders and
     * suppliers. No single permission gates the route; the service includes
     * only the groups this user may open (see GlobalSearchService).
     */
    public function index(Request $request, TenantContext $context, GlobalSearchService $service): JsonResponse
    {
        $results = $service->search(
            $context->get(),
            $request->user(),
            (string) $request->query('q', ''),
        );

        return ApiResponse::ok($results);
    }
}
