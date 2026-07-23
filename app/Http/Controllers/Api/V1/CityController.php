<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\City;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

class CityController extends Controller
{
    /**
     * Active cities — public lookup for registration and marketplace filters.
     */
    public function index(): JsonResponse
    {
        return ApiResponse::ok(
            City::query()->where('is_active', true)->orderBy('name')->get(['id', 'name']),
        );
    }
}
