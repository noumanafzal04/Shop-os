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
    public function __construct(private readonly TenantContext $context) {}

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
        } else {
            /**
             * NOBODY'S SHOP.
             *
             * A customer, a rider and a platform admin all operate outside any
             * tenant, and this branch used to do nothing at all — it relied on
             * the context being a fresh scoped singleton per request, which in
             * production it is.
             *
             * It is not always. Anything that reuses one container across
             * several requests — the test suite does, and so would a queue
             * worker or an Octane process — carries the LAST tenant that was
             * resolved into the next request. A customer request arriving
             * behind a shop owner's then reads `Product`, `Order` and every
             * other scoped model through that shop's fence, and finds nothing
             * belonging to the shop it was actually asking about.
             *
             * Found by a rider test that placed an order at one shop after
             * inviting the same rider at another: the order 404'd because the
             * products were being looked up inside the second shop. That is a
             * 404 in a test and a wrong answer anywhere the container is
             * shared, so the context is now cleared rather than assumed empty.
             *
             * Same shape as the bug in the tenant-binding order — see
             * `shopos-wall-between-shops`. A fence you rely on has to be set,
             * not merely expected.
             */
            $this->context->clear();
        }

        return $next($request);
    }
}
