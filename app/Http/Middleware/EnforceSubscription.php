<?php

namespace App\Http\Middleware;

use App\Support\ApiResponse;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Read-only mode after grace expiry.
 *
 * Edge cases:
 *  - subscription expires DURING business hours → next write is blocked,
 *    reads keep working; nobody is logged out mid-shift
 *  - grace period → everything still works (frontends show the countdown)
 *  - renewal (admin assign-plan) → instantly lifts read-only, data intact
 */
class EnforceSubscription
{
    private const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

    public function __construct(private readonly TenantContext $context) {}

    public function handle(Request $request, Closure $next): Response
    {
        $tenant = $this->context->get();

        if (
            $tenant !== null
            && in_array($request->method(), self::WRITE_METHODS, strict: true)
            && $tenant->subscriptionState() === 'read_only'
        ) {
            return ApiResponse::forbidden(
                'Your subscription has expired. Your data is safe — renew to continue making changes.',
                'SUBSCRIPTION_EXPIRED',
            );
        }

        return $next($request);
    }
}
