<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\Promotion\StorePromotionRequest;
use App\Http\Requests\Promotion\UpdatePromotionRequest;
use App\Models\Promotion;
use App\Services\PromotionService;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Promotions CRUD + a POS preview. Promotions are automatic (no code) — the
 * server applies the best live one at checkout; preview lets the till show it
 * before ringing.
 */
class PromotionController extends Controller
{
    public function index(): JsonResponse
    {
        return ApiResponse::ok(
            Promotion::query()->with('category:id,name')->latest()->get(),
        );
    }

    public function store(StorePromotionRequest $request): JsonResponse
    {
        $promotion = Promotion::create($request->validated());

        return ApiResponse::created($promotion->load('category:id,name'), 'Promotion created');
    }

    public function update(UpdatePromotionRequest $request, string $id): JsonResponse
    {
        $promotion = Promotion::query()->findOrFail($id);
        $promotion->fill($request->validated())->save();

        return ApiResponse::ok($promotion->load('category:id,name'), 'Promotion updated');
    }

    public function destroy(string $id): JsonResponse
    {
        Promotion::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Promotion removed');
    }

    /** POS preview: best live promotion for the current cart (display-only). */
    public function preview(Request $request, PromotionService $service, TenantContext $context): JsonResponse
    {
        $data = $request->validate([
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => ['required', 'uuid'],
            'items.*.variant_id' => ['nullable', 'uuid'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001'],
        ]);

        return ApiResponse::ok(
            $service->preview($data['items'], $context->get()?->timezone),
        );
    }
}
