<?php

namespace App\Http\Middleware;

use App\Models\Branch;
use App\Support\BranchContext;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the ACTIVE (operating) branch for a shop-side request.
 *
 *  - Shop owners may operate ANY branch: an X-Branch-Id header selects it
 *    (a stale/foreign id is ignored, not fatal); with no header they default
 *    to the tenant's Main branch.
 *  - Staff are PINNED to their assigned branch (users.branch_id); a header can
 *    never move them elsewhere. Unassigned staff fall back to Main.
 *
 * The resolved branch is validated against the tenant's own branches before it
 * is trusted — a client can never point stock at another tenant's branch.
 */
class ResolveBranch
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchContext $branch,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        // No tenant context (should not happen inside the shop group) → nothing
        // to scope; leave the active branch unset (sale path falls back to Main).
        if ($user === null || ! $this->tenant->has()) {
            return $next($request);
        }

        $default = Branch::query()->where('is_default', true)->first();

        if ($user->isShopOwner()) {
            // Owner: a valid X-Branch-Id focuses BOTH operations and reports on
            // that branch; with no (or a stale) header they default to Main for
            // operations but see ALL branches in reports (the HQ view).
            $requested = $request->header('X-Branch-Id');
            $active = $requested
                ? Branch::query()->where('is_active', true)->whereKey($requested)->first()
                : null;
            $this->branch->set($active ?? $default, scopeAll: $active === null);
        } else {
            // Staff: pinned to their assignment (validated to this tenant), else
            // Main. Reads are always scoped to that one branch — never all.
            $assigned = $user->branch_id
                ? Branch::query()->whereKey($user->branch_id)->first()
                : null;
            $this->branch->set($assigned ?? $default, scopeAll: false);
        }

        return $next($request);
    }
}
