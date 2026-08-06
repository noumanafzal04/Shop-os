<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Inventory\ApplyStockCountAction;
use App\Actions\Inventory\RecordStockCountAction;
use App\Actions\Inventory\StartStockCountAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Models\StockCount;
use App\Models\StockCountItem;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Counting the shelves.
 *
 * A shop's stock figure drifts — breakage, theft, a sale rung on the wrong
 * item, a delivery received short. Counting is the only way to find out by how
 * much, and the variance in rupees is the number an owner actually acts on.
 */
class StockCountController extends Controller
{
    public function __construct(private readonly BranchContext $branch) {}

    public function index(Request $request): JsonResponse
    {
        $counts = StockCount::query()
            ->with(['branch:id,name', 'startedBy:id,name', 'appliedBy:id,name', 'category:id,name'])
            ->when($this->branch->scopeId(), fn ($q, $b) => $q->where('branch_id', $b))
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 25), 100));

        return ApiResponse::paginated($counts);
    }

    /** The count currently open at this branch, if any — the till's own view. */
    public function current(): JsonResponse
    {
        $count = StockCount::query()
            ->with(['branch:id,name', 'startedBy:id,name', 'category:id,name'])
            ->where('status', StockCount::STATUS_COUNTING)
            ->where('branch_id', $this->branch->id())
            ->first();

        return ApiResponse::ok($count, $count === null ? 'No count open' : 'Count in progress');
    }

    public function store(Request $request, StartStockCountAction $action, TenantContext $context): JsonResponse
    {
        $data = $request->validate([
            'scope' => ['sometimes', Rule::in(['all', 'category'])],
            'category_id' => ['nullable', 'uuid', 'required_if:scope,category', Rule::exists('categories', 'id')],
            // Blind by default: a counter shown the expected figure stops
            // counting when they reach it. Same reason the drawer close is blind.
            'blind' => ['sometimes', 'boolean'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $count = $action->execute($request->user(), $context->id(), [
            'branch_id' => $this->branch->id(),
            'scope' => $data['scope'] ?? 'all',
            'category_id' => $data['category_id'] ?? null,
            'blind' => $data['blind'] ?? true,
            'notes' => $data['notes'] ?? null,
        ]);

        return ApiResponse::created($count, "Count {$count->reference} started");
    }

    public function show(Request $request, string $id): JsonResponse
    {
        /** @var StockCount $count */
        $count = StockCount::query()
            ->with(['branch:id,name', 'startedBy:id,name', 'appliedBy:id,name', 'category:id,name'])
            ->findOrFail($id);

        $items = StockCountItem::query()
            ->where('stock_count_id', $count->id)
            ->when($request->query('search'), function ($q, $search): void {
                $q->where(function ($q) use ($search): void {
                    $q->where('product_name', 'like', "%{$search}%")
                        ->orWhere('sku', 'like', "%{$search}%")
                        ->orWhere('variant_name', 'like', "%{$search}%");
                });
            })
            // "Only what's left" is how a long count is actually finished.
            ->when($request->boolean('uncounted'), fn ($q) => $q->whereNull('counted_quantity'))
            ->orderBy('product_name')
            ->orderBy('variant_name')
            ->get();

        // While a BLIND count is still open, the expected figure is withheld —
        // a counter who knows the answer stops counting when they reach it.
        // Once applied it is the whole point of the record, so it comes back.
        $hide = $count->blind && $count->isOpen();

        return ApiResponse::ok([
            'count' => $count,
            'items' => $items->map(function (StockCountItem $item) use ($hide): array {
                $row = [
                    'id' => $item->id,
                    'product_id' => $item->product_id,
                    'variant_id' => $item->variant_id,
                    'product_name' => $item->product_name,
                    'variant_name' => $item->variant_name,
                    'sku' => $item->sku,
                    'counted_quantity' => $item->counted_quantity,
                    'counted_at' => $item->counted_at?->toIso8601String(),
                ];

                if (! $hide) {
                    $row['expected_quantity'] = $item->expected_quantity;
                    $row['unit_cost'] = $item->unit_cost;
                    $row['variance'] = $item->isCounted() ? $item->variance() : null;
                    $row['variance_value'] = $item->isCounted() ? $item->varianceValue() : null;
                }

                return $row;
            })->all(),
            'blind' => $hide,
            'summary' => $hide ? null : $this->summary($count),
        ]);
    }

    /** Record what was on the shelf — any subset of lines, in any order. */
    public function record(Request $request, string $id, RecordStockCountAction $action): JsonResponse
    {
        /** @var StockCount $count */
        $count = StockCount::query()->findOrFail($id);

        $data = $request->validate([
            'lines' => ['required', 'array', 'min:1', 'max:500'],
            'lines.*.item_id' => ['required', 'uuid'],
            'lines.*.counted_quantity' => ['present', 'nullable', 'numeric', 'min:0', 'max:9999999'],
        ]);

        return ApiResponse::ok($action->execute($request->user(), $count, $data['lines']), 'Saved');
    }

    /**
     * Post the count. Manager-only: applying it writes off stock against the
     * shop's own books, which is not something the person who counted signs
     * for themselves.
     */
    public function apply(Request $request, string $id, ApplyStockCountAction $action): JsonResponse
    {
        abort_unless($request->user()->hasPermission(Permissions::SETTINGS_MANAGE), 403);

        $data = $request->validate(['notes' => ['nullable', 'string', 'max:1000']]);

        /** @var StockCount $count */
        $count = StockCount::query()->findOrFail($id);

        return ApiResponse::ok(
            $action->execute($request->user(), $count, $data['notes'] ?? null),
            'Count applied — stock updated',
        );
    }

    /** Abandon a count. Nothing is written to stock. */
    public function destroy(Request $request, string $id): JsonResponse
    {
        abort_unless($request->user()->hasPermission(Permissions::SETTINGS_MANAGE), 403);

        /** @var StockCount $count */
        $count = StockCount::query()->findOrFail($id);

        if (! $count->isOpen()) {
            throw DomainException::conflict(
                'An applied count is a record — it cannot be cancelled.',
                'STOCK_COUNT_CLOSED',
            );
        }

        $count->forceFill(['status' => StockCount::STATUS_CANCELLED])->save();

        return ApiResponse::ok($count->fresh(), 'Count cancelled');
    }

    /**
     * What the count found so far. Computed live while open, so a manager can
     * see the damage before deciding to sign it off.
     *
     * @return array<string, mixed>
     */
    private function summary(StockCount $count): array
    {
        $items = StockCountItem::query()
            ->where('stock_count_id', $count->id)
            ->whereNotNull('counted_quantity')
            ->get();

        $short = $items->filter(fn (StockCountItem $i): bool => $i->variance() < 0);
        $over = $items->filter(fn (StockCountItem $i): bool => $i->variance() > 0);

        return [
            'counted' => $items->count(),
            'matched' => $items->count() - $short->count() - $over->count(),
            'short_lines' => $short->count(),
            'over_lines' => $over->count(),
            // Kept apart, not netted: a shelf 10 short and another 10 over is
            // two mistakes, not none — and usually one item rung as another.
            'short_value' => round((float) $short->sum(fn (StockCountItem $i): float => abs($i->varianceValue())), 2),
            'over_value' => round((float) $over->sum(fn (StockCountItem $i): float => $i->varianceValue()), 2),
            'net_value' => round((float) $items->sum(fn (StockCountItem $i): float => $i->varianceValue()), 2),
            'net_units' => round((float) $items->sum(fn (StockCountItem $i): float => $i->variance()), 3),
        ];
    }
}
