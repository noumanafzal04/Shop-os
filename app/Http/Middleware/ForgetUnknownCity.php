<?php

namespace App\Http\Middleware;

use App\Models\City;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * A CITY THE PLATFORM DOES NOT KNOW IS NO FILTER AT ALL.
 *
 * The app remembers the city it last resolved and sends its id with every
 * marketplace call. When that row is gone — the city list re-seeded, a city
 * switched off — every query filtered `tenants.city_id = <nothing>` and the
 * home screen said "No shops around here yet" in a city full of them, until
 * the customer happened to pick their location again.
 *
 * So an unknown or inactive `city_id` is dropped before the controller sees
 * it, and the pin (which the app always sends with it) decides. The answer is
 * cached per id: this runs on every marketplace call and city rows almost
 * never change.
 */
class ForgetUnknownCity
{
    public function handle(Request $request, Closure $next): Response
    {
        $id = $request->query('city_id');

        if (is_string($id) && $id !== '' && ! $this->known($id)) {
            $request->query->remove('city_id');
        }

        return $next($request);
    }

    private function known(string $id): bool
    {
        if (! Str::isUuid($id)) {
            // Left for validation to refuse with its own message.
            return true;
        }

        return Cache::remember(
            "city:known:{$id}",
            600,
            fn () => City::query()->whereKey($id)->where('is_active', true)->exists(),
        );
    }
}
