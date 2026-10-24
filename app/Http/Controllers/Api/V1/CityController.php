<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\City;
use App\Models\Country;
use App\Models\Province;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Where a shop can be: country → province → city. Public lookups, read by
 * registration, shop setup, the admin's forms and the marketplace.
 *
 * Reference data that changes perhaps once a year, so every answer may be
 * kept by the browser for a day — a page reload asks nobody.
 */
class CityController extends Controller
{
    private const KEEP = 'public, max-age=86400';

    /**
     * Active cities. Narrowed by `country_id` or `province_id` when asked;
     * with neither, every active city, as it always was.
     */
    public function index(Request $request): JsonResponse
    {
        return ApiResponse::ok(
            City::query()
                ->where('is_active', true)
                ->when($request->filled('country_id'), fn ($q) => $q->where('country_id', $request->integer('country_id')))
                ->when($request->filled('province_id'), fn ($q) => $q->where('province_id', $request->integer('province_id')))
                ->orderBy('name')
                ->get(['id', 'name', 'province_id', 'country_id', 'latitude', 'longitude']),
        )->header('Cache-Control', self::KEEP);
    }

    public function countries(): JsonResponse
    {
        return ApiResponse::ok(
            Country::query()->where('is_active', true)->orderBy('name')
                ->get(['id', 'name', 'iso2', 'phone_code', 'currency']),
        )->header('Cache-Control', self::KEEP);
    }

    public function provinces(Request $request): JsonResponse
    {
        return ApiResponse::ok(
            Province::query()
                ->where('is_active', true)
                ->when($request->filled('country_id'), fn ($q) => $q->where('country_id', $request->integer('country_id')))
                ->orderBy('name')
                ->get(['id', 'country_id', 'name', 'type']),
        )->header('Cache-Control', self::KEEP);
    }
}
