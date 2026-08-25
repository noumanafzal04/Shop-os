<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Actions\Auth\IssueTokensAction;
use App\Actions\Demo\CreateDemoShopAction;
use App\Http\Controllers\Controller;
use App\Support\ApiResponse;
use App\Support\BusinessTypes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * "Try the demo" — the only unauthenticated endpoint that CREATES anything.
 *
 * That is the whole risk of it, and the reason for the throttle on the route:
 * every call writes a tenant, an owner and a shelf. The limit is per IP and
 * deliberately small — somebody evaluating the product needs one shop, maybe
 * two if they want to compare trades, and nobody needs twenty.
 *
 * A demo is entered by the token returned here and by no other door. The
 * owner's password is random and is never sent anywhere, so an abandoned demo
 * cannot be signed back into by whoever is handed the next one.
 */
class DemoController extends Controller
{
    public function store(Request $request, CreateDemoShopAction $create, IssueTokensAction $tokens): JsonResponse
    {
        $data = $request->validate([
            // Named against the real list rather than a copy of it: a trade
            // added next year is offered here without anybody remembering to.
            'business_type' => ['required', 'string', 'in:'.implode(',', BusinessTypes::codes())],
        ]);

        ['tenant' => $tenant, 'owner' => $owner] = $create->execute($data['business_type']);

        $issued = $tokens->execute($owner, 'demo');

        return ApiResponse::created([
            ...$issued,
            'user' => $owner->fresh()->load('tenant'),
            'demo' => [
                'shop' => $tenant->business_name,
                'business_type' => $tenant->business_type,
                // The banner prints this. An absolute moment, so it can say
                // "ends at 4:20pm tomorrow" instead of "expires soon".
                'expires_at' => $tenant->demo_expires_at?->toIso8601String(),
            ],
        ], 'Your demo shop is ready');
    }
}
