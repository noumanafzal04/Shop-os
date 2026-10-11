<?php

namespace App\Actions\Branch;

use App\Actions\Inventory\TransferStockAction;
use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\ProductBatch;
use App\Models\Tenant;
use App\Models\User;
use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;

/**
 * Empty a place so it can go: its stock, and the people assigned to it.
 *
 * A place cannot be deleted while anything live is left in it, and an owner
 * who pressed Delete on a godown holding forty lines was told only that —
 * then left to raise a transfer by hand, line by line, before pressing Delete
 * again. This is the same decision made in the place it is asked:
 *
 *   move     everything on its shelves goes to another place, as one transfer
 *            that is sent and received in the same step. Lots travel as
 *            themselves, so a medicine keeps its batch and expiry.
 *   discard  it is not wanted anywhere. Every shelf is set to nought and its
 *            lots emptied, each with a movement that says why — so the stock
 *            leaves the books in the open and not by the place vanishing
 *            around it.
 *
 * People are a separate answer and always need one: staff left assigned to a
 * place that is gone fall back to Main without anybody deciding it.
 *
 * What a person has to FINISH — an open till, a table, a transfer on the
 * road, an online order — is not done here. Those are refused by the caller,
 * because closing a drawer on somebody's behalf is not tidying up.
 */
class EmptyPlaceAction
{
    public const MOVE = 'move';

    public const DISCARD = 'discard';

    public function __construct(
        private readonly TransferStockAction $transfer,
        private readonly InventoryService $inventory,
    ) {}

    /**
     * What is at the place that somebody has to decide about.
     *
     * @return array{products: int, units: float, people: int}
     */
    public static function holds(Branch $place): array
    {
        $shelves = BranchStock::withoutTenancy()->where('branch_id', $place->id)->where('quantity', '<>', 0);

        return [
            'products' => (clone $shelves)->distinct()->count('product_id'),
            'units' => round((float) (clone $shelves)->where('quantity', '>', 0)->sum('quantity'), 3),
            'people' => User::query()->where('tenant_id', $place->tenant_id)->where('branch_id', $place->id)->count(),
        ];
    }

    /**
     * @param  string|null  $stock  self::MOVE, self::DISCARD, or null to leave the shelves alone
     */
    public function execute(Tenant $tenant, Branch $place, ?string $stock, ?string $stockTo, ?string $peopleTo): void
    {
        DB::transaction(function () use ($tenant, $place, $stock, $stockTo, $peopleTo): void {
            if ($stock === self::MOVE) {
                $this->moveStock($tenant, $place, $this->placeToGoTo($place, $stockTo, 'its stock'));
            } elseif ($stock === self::DISCARD) {
                $this->discardStock($place);
            }

            if ($peopleTo !== null) {
                User::query()
                    ->where('tenant_id', $place->tenant_id)
                    ->where('branch_id', $place->id)
                    ->update(['branch_id' => $this->placeToGoTo($place, $peopleTo, 'its staff')->id]);
            }
        });
    }

    /** Another open place of the same business — never the one being emptied. */
    private function placeToGoTo(Branch $leaving, ?string $id, string $what): Branch
    {
        $to = $id === null ? null : Branch::withoutTenancy()
            ->where('tenant_id', $leaving->tenant_id)
            ->where('is_active', true)
            ->whereKeyNot($leaving->id)
            ->whereKey($id)
            ->first();

        if ($to === null) {
            throw DomainException::unprocessable(
                "Choose another open place to move {$what} to.",
                'PLACE_TO_MOVE_TO_REQUIRED',
            );
        }

        return $to;
    }

    private function moveStock(Tenant $tenant, Branch $place, Branch $to): void
    {
        $shelves = BranchStock::withoutTenancy()->where('branch_id', $place->id)->where('quantity', '<>', 0)->get();

        // A shelf below nought is an IOU — a dish sold before its ingredient
        // was booked in. There is nothing on it to carry anywhere.
        foreach ($shelves->where('quantity', '<', 0) as $owed) {
            $this->zero($place, $owed, "{$place->name} closed — nothing was on this shelf to move");
        }

        $items = $shelves->where('quantity', '>', 0)->map(fn (BranchStock $row): array => [
            'product_id' => $row->product_id,
            'variant_id' => $row->variant_id,
            'quantity' => (float) $row->quantity,
        ])->values()->all();

        if ($items !== []) {
            $this->transfer->execute($tenant, [
                'from_branch_id' => $place->id,
                'to_branch_id' => $to->id,
                'notes' => "Everything at {$place->name}, moved before it was removed",
                'items' => $items,
            ]);
        }
    }

    private function discardStock(Branch $place): void
    {
        foreach (BranchStock::withoutTenancy()->where('branch_id', $place->id)->where('quantity', '<>', 0)->get() as $row) {
            $this->zero($place, $row, "Written off — {$place->name} was removed with its stock");
        }

        // The lots go with the shelves they describe.
        ProductBatch::withoutTenancy()->where('branch_id', $place->id)->where('quantity', '<>', 0)->update(['quantity' => 0]);
    }

    private function zero(Branch $place, BranchStock $row, string $reason): void
    {
        $this->inventory->adjust([
            'product_id' => $row->product_id,
            'variant_id' => $row->variant_id,
            'branch_id' => $place->id,
            'type' => 'set',
            'new_quantity' => 0,
            'reason' => $reason,
            // Lot housekeeping: the lots are emptied by the caller, to match.
            'reference_type' => 'batch',
        ]);
    }
}
