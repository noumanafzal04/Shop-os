<?php

namespace App\Actions\Inventory;

use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\StockTransfer;
use App\Models\StockTransferItem;
use App\Models\Tenant;
use App\Services\InventoryService;
use App\Support\StockPlace;
use App\Support\TransferLots;
use Illuminate\Support\Facades\DB;

/**
 * Send stock from one place to another.
 *
 * The goods leave the sender's shelf NOW — they are on a van, and a shop that
 * still counted them could sell what it no longer has. They are on nobody's
 * shelf until the receiver counts them in (`ReceiveStockTransferAction`), and
 * what the sender's lots gave up is written on each line so it can be put
 * down at the other end as the same lots.
 *
 * Two ways in, and one way out of the shelf:
 *
 *   `execute`  the sender decides to send, and names what.
 *   `fulfil`   the other place ASKED (`RequestStockTransferAction`), and the
 *              sender answers — with what was asked for, or with less.
 *
 * The per-place stock guard does the refusing either way: a place cannot send
 * more than it holds, and the refusal names the item.
 *
 * @phpstan-type Line array{product_id: string, variant_id?: ?string, quantity: float|int|string}
 */
class SendStockTransferAction
{
    public function __construct(private readonly InventoryService $inventory) {}

    /**
     * @param  array{from_branch_id: string, to_branch_id: string, notes?: ?string, items: array<int, Line>}  $data
     */
    public function execute(Tenant $tenant, array $data): StockTransfer
    {
        self::twoOpenPlaces($tenant, $data);
        StockPlace::mustActAt(auth()->user(), $data['from_branch_id'], 'send stock from');

        return DB::transaction(function () use ($tenant, $data): StockTransfer {
            $transfer = self::open($tenant, $data, StockTransfer::IN_TRANSIT);

            foreach (self::lines($tenant, $transfer, $data['items']) as $item) {
                $this->takeOffTheShelf($transfer, $item);
            }

            return self::sent($transfer);
        });
    }

    /**
     * Answer a request: send what was asked for, or what can be spared.
     *
     * @param  array<string, float|int|string>  $sending  item id → how much is going. A line left out goes in full.
     */
    public function fulfil(StockTransfer $transfer, array $sending = []): StockTransfer
    {
        StockPlace::mustActAt(auth()->user(), $transfer->from_branch_id, 'send stock from');

        return DB::transaction(function () use ($transfer, $sending): StockTransfer {
            /** @var StockTransfer $transfer */
            $transfer = StockTransfer::query()->whereKey($transfer->id)->lockForUpdate()->firstOrFail();

            if ($transfer->status !== StockTransfer::REQUESTED) {
                throw DomainException::conflict(
                    "Transfer {$transfer->reference} is not waiting to be sent.",
                    'TRANSFER_NOT_REQUESTED',
                );
            }

            $items = $transfer->items()->get();
            foreach ($items as $item) {
                $going = array_key_exists($item->id, $sending) ? round((float) $sending[$item->id], 3) : (float) $item->quantity_requested;
                if ($going < 0) {
                    throw DomainException::unprocessable("{$item->product_name}: a quantity cannot be less than nothing.", 'TRANSFER_QUANTITY_INVALID');
                }
                $item->forceFill(['quantity' => $going])->save();
            }

            // Sending none of it is not an answer to a request — declining is.
            if ($items->sum(fn (StockTransferItem $i) => (float) $i->quantity) <= 0) {
                throw DomainException::unprocessable(
                    'Nothing is being sent. Decline the request instead, so the place that asked knows.',
                    'TRANSFER_SENDS_NOTHING',
                );
            }

            foreach ($items as $item) {
                $this->takeOffTheShelf($transfer, $item);
            }

            return self::sent($transfer);
        });
    }

    /** Both ends are this business's, open, and not the same place. */
    public static function twoOpenPlaces(Tenant $tenant, array $data): void
    {
        if ($data['from_branch_id'] === $data['to_branch_id']) {
            throw DomainException::unprocessable(
                'Choose two different places — a transfer moves stock from one to another.',
                'TRANSFER_SAME_BRANCH',
            );
        }

        $places = Branch::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('is_active', true)
            ->whereIn('id', [$data['from_branch_id'], $data['to_branch_id']])
            ->pluck('id');
        if ($places->count() < 2) {
            throw DomainException::notFound('One of those places is closed or no longer exists.');
        }
    }

    /** A new transfer, numbered, in the state it starts in. */
    public static function open(Tenant $tenant, array $data, string $status): StockTransfer
    {
        // One transfer at a time takes a number. Two made in the same second
        // used to count the same rows and reach for the same reference, and
        // the second failed on the unique index.
        Tenant::query()->whereKey($tenant->id)->lockForUpdate()->first();
        $next = StockTransfer::withoutTenancy()->withTrashed()->where('tenant_id', $tenant->id)->count() + 1;

        return StockTransfer::withoutTenancy()->create([
            'tenant_id' => $tenant->id,
            'reference' => 'TRF-'.str_pad((string) $next, 6, '0', STR_PAD_LEFT),
            'from_branch_id' => $data['from_branch_id'],
            'to_branch_id' => $data['to_branch_id'],
            'status' => $status,
            'notes' => $data['notes'] ?? null,
            'created_by' => auth()->id(),
        ]);
    }

    /**
     * The lines of a new transfer, each named as it will be read on the slip.
     *
     * @param  array<int, Line>  $lines
     * @return list<StockTransferItem>
     */
    public static function lines(Tenant $tenant, StockTransfer $transfer, array $lines, bool $asked = false): array
    {
        $items = [];
        foreach ($lines as $line) {
            /** @var Product $product */
            $product = Product::withoutTenancy()
                ->where('tenant_id', $tenant->id)
                ->whereKey($line['product_id'])
                ->firstOrFail();

            $variantId = $line['variant_id'] ?? null;
            $variant = $variantId === null ? null : ProductVariant::withoutTenancy()
                ->where('product_id', $product->id)
                ->whereKey($variantId)
                ->firstOrFail();

            $items[] = StockTransferItem::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'stock_transfer_id' => $transfer->id,
                'product_id' => $product->id,
                'variant_id' => $variant?->id,
                'product_name' => $product->name,
                'variant_name' => $variant?->name,
                'quantity' => (float) $line['quantity'],
                'quantity_requested' => $asked ? (float) $line['quantity'] : null,
            ]);
        }

        return $items;
    }

    private function takeOffTheShelf(StockTransfer $transfer, StockTransferItem $item): void
    {
        if ((float) $item->quantity <= 0) {
            return;
        }

        $out = $this->inventory->adjust([
            'product_id' => $item->product_id,
            'variant_id' => $item->variant_id,
            'branch_id' => $transfer->from_branch_id,
            'type' => 'out',
            'quantity' => (float) $item->quantity,
            'reason' => "Transfer {$transfer->reference}",
            'reference_type' => 'transfer',
            'reference_id' => $transfer->id,
            'idempotency_key' => "transfer-{$transfer->id}-{$item->id}-out",
        ]);

        $lots = TransferLots::takenBy($out);
        if ($lots !== []) {
            $item->forceFill(['lots' => $lots])->save();
        }
    }

    private static function sent(StockTransfer $transfer): StockTransfer
    {
        $transfer->forceFill([
            'status' => StockTransfer::IN_TRANSIT,
            'sent_at' => now(),
            'sent_by' => auth()->id(),
        ])->save();

        return $transfer->load('items', 'fromBranch:id,name,kind', 'toBranch:id,name,kind');
    }
}
