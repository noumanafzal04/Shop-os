<?php

namespace App\Actions\Inventory;

use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\Product;
use App\Models\StockTransfer;
use App\Models\StockTransferItem;
use App\Models\Tenant;
use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;

/**
 * Move stock from one branch to another — out of the source, into the
 * destination, atomically, through the branch-aware InventoryService (so the
 * source can't send more than it holds, and per-branch on-hand + rollups stay
 * correct). Records an audit trail (transfer + line items).
 *
 * @param array{from_branch_id: string, to_branch_id: string, notes?: ?string,
 *   items: array<int, array{product_id: string, variant_id?: ?string, quantity: float}>} $data
 */
class TransferStockAction
{
    public function __construct(private readonly InventoryService $inventory)
    {
    }

    public function execute(Tenant $tenant, array $data): StockTransfer
    {
        if ($data['from_branch_id'] === $data['to_branch_id']) {
            throw DomainException::unprocessable(
                'Choose two different branches — a transfer moves stock between locations.',
                'TRANSFER_SAME_BRANCH',
            );
        }

        // Both branches must belong to this tenant.
        $branchIds = Branch::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->whereIn('id', [$data['from_branch_id'], $data['to_branch_id']])
            ->pluck('id');
        if ($branchIds->count() < 2) {
            throw DomainException::notFound('Branch not found.');
        }

        return DB::transaction(function () use ($tenant, $data): StockTransfer {
            $next = StockTransfer::withoutTenancy()->where('tenant_id', $tenant->id)->count() + 1;

            $transfer = StockTransfer::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'reference' => 'TRF-'.str_pad((string) $next, 6, '0', STR_PAD_LEFT),
                'from_branch_id' => $data['from_branch_id'],
                'to_branch_id' => $data['to_branch_id'],
                'status' => 'completed',
                'notes' => $data['notes'] ?? null,
                'created_by' => auth()->id(),
            ]);

            foreach ($data['items'] as $i => $line) {
                /** @var Product $product */
                $product = Product::withoutTenancy()
                    ->where('tenant_id', $tenant->id)
                    ->whereKey($line['product_id'])
                    ->firstOrFail();

                $qty = (float) $line['quantity'];
                $variantId = $line['variant_id'] ?? null;

                // Out of source — the per-branch negative guard blocks sending
                // more than the source branch actually holds.
                $this->inventory->adjust([
                    'product_id' => $product->id,
                    'variant_id' => $variantId,
                    'branch_id' => $data['from_branch_id'],
                    'type' => 'out',
                    'quantity' => $qty,
                    'reason' => "Transfer {$transfer->reference}",
                    'reference_type' => 'transfer',
                    'reference_id' => $transfer->id,
                    'idempotency_key' => "transfer-{$transfer->id}-{$i}-out",
                ]);

                // Into destination.
                $this->inventory->adjust([
                    'product_id' => $product->id,
                    'variant_id' => $variantId,
                    'branch_id' => $data['to_branch_id'],
                    'type' => 'in',
                    'quantity' => $qty,
                    'reason' => "Transfer {$transfer->reference}",
                    'reference_type' => 'transfer',
                    'reference_id' => $transfer->id,
                    'idempotency_key' => "transfer-{$transfer->id}-{$i}-in",
                ]);

                StockTransferItem::withoutTenancy()->create([
                    'tenant_id' => $tenant->id,
                    'stock_transfer_id' => $transfer->id,
                    'product_id' => $product->id,
                    'variant_id' => $variantId,
                    'product_name' => $product->name,
                    'quantity' => $qty,
                ]);
            }

            return $transfer->load('items', 'fromBranch:id,name', 'toBranch:id,name');
        });
    }
}
