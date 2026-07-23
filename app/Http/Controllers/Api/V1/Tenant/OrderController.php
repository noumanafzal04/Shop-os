<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Enums\OrderStatus;
use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Services\OrderService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class OrderController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $orders = Order::query()
            ->with('items', 'rider')
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->when($request->boolean('open_only'), fn ($q) => $q->whereNotIn('status', ['completed', 'cancelled']))
            ->orderByDesc('placed_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated($orders);
    }

    public function show(string $id): JsonResponse
    {
        return ApiResponse::ok(Order::query()->with('items', 'rider')->findOrFail($id));
    }

    public function assignRider(Request $request, string $id, OrderService $service): JsonResponse
    {
        $data = $request->validate([
            // null clears the assignment; a uuid must be one of this shop's riders.
            'rider_id' => [
                'nullable', 'uuid',
                Rule::exists('riders', 'id')
                    ->where('tenant_id', $request->user()->tenant_id)
                    ->whereNull('deleted_at'),
            ],
        ]);

        $rider = $data['rider_id'] !== null
            ? \App\Models\Rider::query()->findOrFail($data['rider_id'])
            : null;

        $order = $service->assignRider(Order::query()->with('items')->findOrFail($id), $rider);

        return ApiResponse::ok($order, $rider !== null ? "Assigned to {$rider->name}" : 'Rider cleared');
    }

    public function advance(Request $request, string $id, OrderService $service): JsonResponse
    {
        $data = $request->validate(['status' => ['required', Rule::enum(OrderStatus::class)]]);

        $order = $service->advance(
            Order::query()->with('items')->findOrFail($id),
            OrderStatus::from($data['status']),
        );

        return ApiResponse::ok($order, "Order {$order->order_number} → {$order->status->value}");
    }

    public function cancel(Request $request, string $id, OrderService $service): JsonResponse
    {
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:255']]);

        $order = $service->cancel(
            Order::query()->with('items')->findOrFail($id),
            $data['reason'] ?? 'Cancelled by shop',
        );

        return ApiResponse::ok($order, 'Order cancelled — stock restored');
    }
}
