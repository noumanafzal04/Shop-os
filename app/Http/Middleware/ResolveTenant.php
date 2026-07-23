<?php

namespace App\Http\Middleware;

use App\Support\ApiResponse;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the tenant from the authenticated user — never from client input.
 *
 * Edge cases handled:
 *  - tenant-scoped role without a tenant       → 403 TENANT_CONTEXT_MISSING
 *  - tenant soft-deleted                       → 403 TENANT_DELETED
 *  - tenant suspended                          → 403 TENANT_SUSPENDED
 *  - suspended user                            → 403 ACCOUNT_SUSPENDED
 */
class ResolveTenant
{
    public function __construct(private readonly TenantContext $context)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user === null) {
            return ApiResponse::unauthorized();
        }

        if (! $user->isActive()) {
            return ApiResponse::forbidden('Your account has been suspended.', 'ACCOUNT_SUSPENDED');
        }

        if ($user->role->requiresTenant()) {
            // withTrashed: distinguish "deleted" from "missing" for a precise error.
            $tenant = $user->tenant()->withTrashed()->first();

            if ($tenant === null) {
                return ApiResponse::forbidden('No business is linked to this account.', 'TENANT_CONTEXT_MISSING');
            }

            if ($tenant->trashed()) {
                return ApiResponse::forbidden('This business account has been deleted.', 'TENANT_DELETED');
            }

            if ($tenant->isSuspended()) {
                return ApiResponse::forbidden('This business account is suspended.', 'TENANT_SUSPENDED');
            }

            $this->context->set($tenant);
        }

        return $next($request);
    }
}
