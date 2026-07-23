<?php

namespace App\Http\Middleware;

use App\Support\ApiResponse;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Role gate: ->middleware('role:super_admin') or 'role:shop_owner,staff'.
 */
class EnsureRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();

        if ($user === null) {
            return ApiResponse::unauthorized();
        }

        if (! in_array($user->role->value, $roles, strict: true)) {
            return ApiResponse::forbidden('You do not have permission to perform this action.');
        }

        return $next($request);
    }
}
