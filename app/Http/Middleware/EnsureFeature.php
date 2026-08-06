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
 *
 * Several modules may be listed — 'feature:products,services' — and the gate
 * then reads as ANY of them. That is the honest shape for a screen one module
 * is enough to justify: the catalog belongs to a shop that sells goods OR
 * bills labour, and a shop with neither has no catalog at all. Requiring BOTH
 * is a different rule, written by chaining two gates.
 */
class EnsureFeature
{
    public function __construct(private readonly TenantContext $context) {}

    public function handle(Request $request, Closure $next, string ...$features): Response
    {
        $tenant = $this->context->get();

        if ($tenant === null) {
            return ApiResponse::unauthorized();
        }

        $enabled = false;
        foreach ($features as $feature) {
            if ($tenant->featureEnabled($feature)) {
                $enabled = true;
                break;
            }
        }

        if (! $enabled) {
            return ApiResponse::forbidden(
                'This module is not enabled for your shop.',
                'MODULE_DISABLED',
            );
        }

        return $next($request);
    }
}
