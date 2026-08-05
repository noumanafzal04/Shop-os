<?php

namespace App\Actions\SaleDocument;

use App\Actions\Pos\RecordCashMovementAction;
use App\Enums\ItemType;
use App\Exceptions\DomainException;
use App\Models\Income;
use App\Models\Product;
use App\Models\SaleDocument;
use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;

/**
 * The deal fell through.
 *
 * A quotation costs nothing to cancel — no money moved, no goods moved. It is
 * closed so it stops appearing on the counter's open list.
 *
 * A layaway is where the care goes, because the shop is holding two things
 * that belong to other people: the customer's money, and its own goods that
 * nobody can buy.
 *
 *  - THE GOODS GO BACK ON THE SHELF, through the audited path, so the units
 *    reappear where they left from. Miss this and every abandoned layaway
 *    quietly writes off stock the shop still physically owns.
 *
 *  - THE MONEY IS SPLIT, EXPLICITLY. Some shops return every rupee, some keep
 *    a cancellation fee for six weeks of holding a fridge nobody could sell.
 *    Both are legitimate; what isn't legitimate is the software deciding
 *    quietly. The caller states the refund and the forfeit, they must add up
 *    to what was paid, and the split is recorded on the document so the
 *    customer can be shown exactly what happened to their advance.
 *
 *  - A CASH REFUND LEAVES A DRAWER, so it is written as a `deposit_out`
 *    movement — the mirror of the `deposit_in` that recorded it arriving.
 *
 *  - A FORFEITED ADVANCE IS INCOME, NOT A SALE. Nothing was sold — the shop
 *    kept a fee. Recording it as income keeps the drawer, the P&L and the
 *    sales figures each telling the truth about their own thing.
 */
class CancelSaleDocumentAction
{
    public function __construct(
        private readonly InventoryService $inventory,
        private readonly RecordCashMovementAction $cash,
    ) {}

    /**
     * @param  array{reason?: ?string, refund_amount?: float|int|string|null,
     *   forfeit_amount?: float|int|string|null, refund_method?: string}  $data
     */
    public function execute(SaleDocument $document, array $data = []): SaleDocument
    {
        return DB::transaction(function () use ($document, $data): SaleDocument {
            /** @var SaleDocument $doc */
            $doc = SaleDocument::query()
                ->with('items')
                ->whereKey($document->id)
                ->lockForUpdate()
                ->firstOrFail();

            if (! $doc->isOpen()) {
                throw DomainException::conflict(
                    $doc->status === SaleDocument::STATUS_CONVERTED
                        ? "{$doc->number} has already been billed — return the sale instead."
                        : "{$doc->number} was already cancelled.",
                    'DOCUMENT_NOT_OPEN',
                );
            }

            $paid = round((float) $doc->deposit_paid, 2);
            $refund = 0.0;
            $forfeit = 0.0;

            if ($paid > 0) {
                $refundGiven = array_key_exists('refund_amount', $data) && $data['refund_amount'] !== null;
                $forfeitGiven = array_key_exists('forfeit_amount', $data) && $data['forfeit_amount'] !== null;

                // State one and the other is inferred; state both and they are
                // taken at face value and checked against what was paid. The
                // default when neither is given is to hand every rupee back —
                // the generous default is the safe one, since keeping someone's
                // money by accident is the worse mistake.
                if ($refundGiven && $forfeitGiven) {
                    $refund = round((float) $data['refund_amount'], 2);
                    $forfeit = round((float) $data['forfeit_amount'], 2);
                } elseif ($refundGiven) {
                    $refund = round((float) $data['refund_amount'], 2);
                    $forfeit = round($paid - $refund, 2);
                } elseif ($forfeitGiven) {
                    $forfeit = round((float) $data['forfeit_amount'], 2);
                    $refund = round($paid - $forfeit, 2);
                } else {
                    $refund = $paid;
                    $forfeit = 0.0;
                }

                if ($refund < -0.001 || $forfeit < -0.001) {
                    throw DomainException::unprocessable(
                        'The refund and the amount kept cannot be negative.',
                        'INVALID_REFUND_SPLIT',
                    );
                }

                if (abs(round($refund + $forfeit, 2) - $paid) > 0.001) {
                    throw DomainException::unprocessable(
                        'The refund and the amount kept must add up to what the customer paid.',
                        'REFUND_SPLIT_MISMATCH',
                    );
                }
            }

            // ── The goods go back ───────────────────────────────────
            if ($doc->stock_reserved) {
                foreach ($doc->items as $item) {
                    if ($item->product_id === null) {
                        continue; // product since deleted — nothing to restore it to
                    }

                    /** @var Product|null $product */
                    $product = Product::query()->whereKey($item->product_id)->first();

                    if ($product === null || $product->type !== ItemType::Product || ! $product->track_inventory) {
                        continue;
                    }

                    $this->inventory->adjust([
                        'product_id' => $item->product_id,
                        'variant_id' => $item->variant_id,
                        'type' => 'in',
                        'quantity' => round((float) $item->quantity * (float) $item->unit_factor, 3),
                        'reason' => "Advance cancelled {$doc->number}",
                        'reference_type' => 'layaway_cancel',
                        'reference_id' => $doc->id,
                        'branch_id' => $doc->branch_id,
                    ]);
                }
            }

            // ── The money ───────────────────────────────────────────
            $user = auth()->user();

            if ($refund > 0 && ($data['refund_method'] ?? 'cash') === 'cash' && $user !== null) {
                $this->cash->record($user, [
                    'type' => 'deposit_out',
                    'amount' => $refund,
                    'reason' => 'Advance refunded · '.$doc->number,
                    'source_type' => 'sale_document',
                    'source_id' => $doc->id,
                ]);
            }

            if ($forfeit > 0) {
                Income::query()->create([
                    'tenant_id' => $doc->tenant_id,
                    'description' => "Forfeited advance · {$doc->number}",
                    'amount' => $forfeit,
                    'income_date' => today(),
                    'notes' => $data['reason'] ?? null,
                ]);
            }

            $doc->forceFill([
                'status' => SaleDocument::STATUS_CANCELLED,
                'cancelled_at' => now(),
                'cancel_reason' => $data['reason'] ?? null,
                'refunded_amount' => $refund,
                'forfeited_amount' => $forfeit,
                'stock_reserved' => false,
            ])->save();

            return $doc->fresh(['items', 'payments']);
        });
    }
}
