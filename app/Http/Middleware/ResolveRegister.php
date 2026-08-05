<?php

namespace App\Http\Middleware;

use App\Models\CashSession;
use App\Models\Register;
use App\Support\BranchContext;
use App\Support\RegisterContext;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the ACTIVE TERMINAL (register / lane) for a shop-side request.
 *
 * The terminal is a property of the MACHINE, not the person: lane 3 is lane 3
 * whoever is standing at it. The POS stores its choice on the device and sends
 * it as X-Register-Id on every request.
 *
 * Resolution, in order:
 *   1. a valid X-Register-Id header — must belong to this tenant, be active,
 *      and sit on the operating branch (a header can never point a sale at
 *      another site's lane);
 *   2. otherwise the lane of the user's own OPEN shift, so a cashier who has
 *      already opened lane 2 keeps ringing on lane 2 even if the header is
 *      lost (a refresh, a reinstalled browser, a swapped tablet);
 *   3. otherwise null — a shop with no lanes, which is the original behaviour.
 *
 * A stale or foreign id is ignored, never fatal: a cashier must not be locked
 * out of the till because a device carries an id that was deleted last week.
 */
class ResolveRegister
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchContext $branch,
        private readonly RegisterContext $register,
    ) {
    }

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user === null || ! $this->tenant->has()) {
            return $next($request);
        }

        $requested = $request->header('X-Register-Id');
        $active = null;

        if ($requested) {
            $active = Register::query()
                ->where('is_active', true)
                ->whereKey($requested)
                ->first();

            // A lane at another branch is not this terminal — ignore it rather
            // than let a header move a sale (and its stock) across sites.
            $branchId = $this->branch->id();
            if ($active !== null && $active->branch_id !== null && $branchId !== null && $active->branch_id !== $branchId) {
                $active = null;
            }
        }

        if ($active === null) {
            $openShift = CashSession::query()
                ->where('user_id', $user->id)
                ->where('status', 'open')
                ->whereNotNull('register_id')
                ->first();

            if ($openShift !== null) {
                $active = Register::query()->whereKey($openShift->register_id)->first();
            }
        }

        $this->register->set($active);

        return $next($request);
    }
}
