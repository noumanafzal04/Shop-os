<?php

namespace App\Http\Middleware;

use App\Support\ApiResponse;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Permission gate: ->middleware('permission:tenants.create').
 * Scope owners pass automatically (see User::hasPermission).
 */
class EnsurePermission
{
    public function handle(Request $request, Closure $next, string $permission): Response
    {
        $user = $request->user();

        if ($user === null) {
            return ApiResponse::unauthorized();
        }

        if (! $user->hasPermission($permission)) {
            return ApiResponse::forbidden(
                'You do not have permission to perform this action.',
                'PERMISSION_DENIED',
            );
        }

        return $next($request);
    }
}
