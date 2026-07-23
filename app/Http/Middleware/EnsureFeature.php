<?php

namespace App\Http\Middleware;

use App\Support\ApiResponse;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Module gate: ->middleware('feature:expenses'). Blocks a route when the
 * tenant's module (feature flag) is switched off — modules are admin-controlled
 * per tenant (see App\Support\Modules). Complements the permission gate: a user
 * may have the permission, but the shop must also have the module enabled.
 */
class EnsureFeature
{
    public function __construct(private readonly TenantContext $context) {}

    public function handle(Request $request, Closure $next, string $feature): Response
    {
        $tenant = $this->context->get();

        if ($tenant === null) {
            return ApiResponse::unauthorized();
        }

        if (! $tenant->featureEnabled($feature)) {
            return ApiResponse::forbidden(
                'This module is not enabled for your shop.',
                'MODULE_DISABLED',
            );
        }

        return $next($request);
    }
}
