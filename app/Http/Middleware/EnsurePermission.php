<?php

namespace App\Http\Middleware;

use App\Support\ApiResponse;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Permission gate: ->middleware('permission:tenants.create').
 * Scope owners pass automatically (see User::hasPermission).
 *
 * Several permissions may be listed — 'permission:products.manage,sales.manage'
 * — and the gate then reads as ANY of them, matching the module gate's shape
 * (see EnsureFeature).
 *
 * That plural form exists for one reason, and it is worth stating so nobody
 * "tidies" it back to a single permission: a READ is very often justified by
 * more than one job. The catalog is the clearest case. A cashier reads it to
 * ring a sale, a waiter to build a tab, a stock keeper to count a shelf, a
 * buyer to raise a purchase order — four different jobs, one list of what the
 * shop sells. Gating that read on products.manage alone (the permission to
 * EDIT the catalog) is what put an empty product grid in front of a real
 * cashier: the API answered 403 and the panel drew nothing.
 *
 * Reads get the plural gate. Writes keep a single permission, because the
 * question "who may change this?" genuinely has one answer.
 */
class EnsurePermission
{
    public function handle(Request $request, Closure $next, string ...$permissions): Response
    {
        $user = $request->user();

        if ($user === null) {
            return ApiResponse::unauthorized();
        }

        if (! $user->hasAnyPermission(...$permissions)) {
            return ApiResponse::forbidden(
                'You do not have permission to perform this action.',
                'PERMISSION_DENIED',
            );
        }

        return $next($request);
    }
}
