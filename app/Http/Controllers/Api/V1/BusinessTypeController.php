<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\ApiResponse;
use App\Support\BusinessTypes;
use App\Support\ItemTypes;
use Illuminate\Http\JsonResponse;

class BusinessTypeController extends Controller
{
    /**
     * Business-type catalog for onboarding — includes coming-soon types
     * (available=false) so UIs can show them greyed out.
     */
    public function index(): JsonResponse
    {
        $types = collect(BusinessTypes::all())->map(fn (array $t, string $code) => [
            'code' => $code,
            'label' => $t['label'],
            'examples' => $t['examples'],
            'available' => $t['available'],
            'features' => $t['features'],
            'item_types' => BusinessTypes::itemTypesFor($code),
            'default_categories' => $t['product_categories'],
            'default_expense_categories' => $t['expense_categories'],
        ])->values();

        return ApiResponse::ok($types);
    }

    /** The item-type capability matrix (physical/food/medicine/service). */
    public function itemTypes(): JsonResponse
    {
        $types = collect(ItemTypes::all())->map(fn (array $t, string $code) => [
            'code' => $code,
            'label' => $t['label'],
            'inventory' => $t['inventory'],   // required | optional | never
            'variants' => $t['variants'],
            'modifiers' => $t['modifiers'],
            'addons' => $t['addons'],
            'pos' => $t['pos'],
            'marketplace' => $t['marketplace'],
        ])->values();

        return ApiResponse::ok($types);
    }
}
