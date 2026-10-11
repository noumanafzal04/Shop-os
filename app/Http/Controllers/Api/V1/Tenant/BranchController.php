<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Branch\EmptyPlaceAction;
use App\Enums\OrderStatus;
use App\Enums\RestaurantTicketStatus;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Branch\DeleteBranchRequest;
use App\Http\Requests\Branch\StoreBranchRequest;
use App\Http\Requests\Branch\UpdateBranchRequest;
use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\CashSession;
use App\Models\Order;
use App\Models\RestaurantTicket;
use App\Models\StockTransfer;
use App\Models\User;
use App\Support\ApiResponse;
use App\Support\PlanLimits;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class BranchController extends Controller
{
    /** All of the tenant's branches — default (Main) first, then by name. */
    public function index(): JsonResponse
    {
        $branches = Branch::query()
            ->with('city:id,name')
            ->orderByDesc('is_default')
            ->orderBy('name')
            ->get();

        return ApiResponse::ok($branches);
    }

    /**
     * Add a place — a shop or a warehouse, each counted against its own
     * allowance. Main counts as one of the shops.
     */
    public function store(StoreBranchRequest $request, TenantContext $context): JsonResponse
    {
        $data = $request->validated();
        $kind = $data['kind'] ?? Branch::KIND_SHOP;

        $this->refuseAWarehouseWithNothingToHold($context, $kind);
        PlanLimits::assert($context->get(), self::limitFor($kind));

        $branch = Branch::query()->create([
            ...$data,
            'kind' => $kind,
            'is_default' => false,
            // A shop fills online orders, as it always has. A warehouse does
            // only when its owner says so.
            'fills_orders' => $kind === Branch::KIND_SHOP ? true : (bool) ($data['fills_orders'] ?? false),
        ]);

        return ApiResponse::created(
            $branch->load('city:id,name'),
            $kind === Branch::KIND_WAREHOUSE ? 'Warehouse added' : 'Branch added',
        );
    }

    public function update(UpdateBranchRequest $request, TenantContext $context, string $id): JsonResponse
    {
        /** @var Branch $branch */
        $branch = Branch::query()->findOrFail($id);
        $data = $request->validated();
        $kind = $data['kind'] ?? $branch->kind;

        if ($kind !== $branch->kind) {
            $this->refuseAWarehouseWithNothingToHold($context, $kind);
            $this->refuseAKindThatDoesNotFit($branch, $kind);
            // It leaves one allowance and enters the other.
            PlanLimits::assert($context->get(), self::limitFor($kind));
        }

        // A shop is never asked this question, so it is never left holding a
        // "no" from the time it was a warehouse.
        if ($kind === Branch::KIND_SHOP) {
            $data['fills_orders'] = true;
        }

        // CLOSING is held to what deleting is. A closed place is left out of
        // every list of places — so stock left in it would be on the books
        // and on no screen, and a keeper left assigned to it would be working
        // somewhere nobody can choose.
        if ($branch->is_active && array_key_exists('is_active', $data) && ! $data['is_active']) {
            $this->refuseWhileStillInUse($branch, 'closed');
            // Nothing is delivered to a place that is shut.
            $data['takes_deliveries'] = false;
        }

        $branch->update($data);

        return ApiResponse::ok($branch->load('city:id,name'), $branch->isWarehouse() ? 'Warehouse updated' : 'Branch updated');
    }

    /**
     * A warehouse is for stock. A business that keeps none — an office that
     * bought only the books — has nothing to put in one, and no screen that
     * would ever show what was in it.
     */
    private function refuseAWarehouseWithNothingToHold(TenantContext $context, string $kind): void
    {
        if ($kind === Branch::KIND_WAREHOUSE && ! PlanLimits::appliesTo($context->get(), 'warehouses')) {
            throw DomainException::unprocessable(
                'A warehouse holds stock, and stock keeping is not switched on for this business.',
                'WAREHOUSE_NEEDS_STOCK',
            );
        }
    }

    /**
     * A PLACE GOES ONLY WHEN NOTHING IS LEFT IN IT AND NOBODY IS LEFT AT IT.
     *
     * Deleting — or closing — a place removes it from every list of places.
     * It does NOT remove what happened there: its sales, expenses and stock
     * movements stay in the books and in every all-branches figure, for good.
     * So the question is only ever about what is still LIVE at it, and each
     * of these was a way for something live to be stranded:
     *
     *   stock      the shelf figure of every product is the sum over its
     *              places. A deleted place's rows were still in that sum — on
     *              the books, and impossible to sell, count or move.
     *   transfers  thirty cartons on a van to a place that no longer exists.
     *   a till     cash in an open drawer, and no screen left to close it on.
     *   a table    a bill nobody can settle.
     *   orders     an online order still to be packed here.
     *   people     staff assigned here fall back to Main the moment it goes —
     *              a cashier quietly selling another branch's shelf, which is
     *              the exact thing the assignment exists to prevent.
     *
     * Each refusal says what to do first, because "cannot be deleted" on its
     * own sends an owner looking for a bug.
     *
     * @param  string  $doing  'deleted' or 'closed' — for the sentence
     */
    private function refuseWhileStillInUse(Branch $branch, string $doing): void
    {
        $name = $branch->name;

        $this->refuseWhatSomebodyMustFinish($branch, $doing);

        if (BranchStock::withoutTenancy()->where('branch_id', $branch->id)->where('quantity', '<>', 0)->exists()) {
            throw DomainException::conflict(
                "{$name} still holds stock. Move it to another place first — or say it is to be written off — or it would stay on the books with nowhere to be.",
                'BRANCH_HOLDS_STOCK',
            );
        }

        $people = User::query()->where('tenant_id', $branch->tenant_id)->where('branch_id', $branch->id)->count();
        if ($people > 0) {
            throw DomainException::conflict(
                ($people === 1 ? 'One person works' : "{$people} people work")." at {$name}. Move them to another place first — otherwise they would be moved to Main without anybody deciding it.",
                'BRANCH_HAS_STAFF',
            );
        }
    }

    /**
     * The half of "still in use" that nobody can decide away from a dialog:
     * a drawer has to be counted, a table settled, a van met at the door.
     */
    private function refuseWhatSomebodyMustFinish(Branch $branch, string $doing): void
    {
        $name = $branch->name;

        if ($branch->is_default) {
            throw DomainException::conflict(
                "The main branch cannot be {$doing} — every business keeps at least one location.",
                'BRANCH_IS_DEFAULT',
            );
        }

        if (StockTransfer::query()->whereIn('status', StockTransfer::OPEN)->touching($branch->id)->exists()) {
            throw DomainException::conflict(
                "A transfer to or from {$name} is not finished yet. Receive or settle it first.",
                'BRANCH_HAS_OPEN_TRANSFERS',
            );
        }

        if (CashSession::query()->where('branch_id', $branch->id)->where('status', 'open')->exists()) {
            throw DomainException::conflict(
                "A till is still open at {$name}. Close its shift first, so the cash in the drawer is counted.",
                'BRANCH_STILL_SELLING',
            );
        }

        if (RestaurantTicket::query()->where('branch_id', $branch->id)->where('status', RestaurantTicketStatus::Open)->exists()) {
            throw DomainException::conflict(
                "A table is still open at {$name}. Settle or cancel it first.",
                'BRANCH_STILL_SELLING',
            );
        }

        $orders = Order::query()->where('branch_id', $branch->id)
            ->whereNotIn('status', [OrderStatus::Completed, OrderStatus::Cancelled])
            ->count();
        if ($orders > 0) {
            throw DomainException::conflict(
                $orders === 1
                    ? "An online order is still being filled from {$name}. Complete or cancel it first."
                    : "{$orders} online orders are still being filled from {$name}. Complete or cancel them first.",
                'BRANCH_HAS_OPEN_ORDERS',
            );
        }
    }

    /** Which allowance a place of this kind is counted against. */
    private static function limitFor(string $kind): string
    {
        return $kind === Branch::KIND_WAREHOUSE ? 'warehouses' : 'branches';
    }

    /**
     * A SHOP CANNOT BECOME A WAREHOUSE WHILE IT IS STILL SELLING.
     *
     * A warehouse has no till. Turning a shop into one with a drawer open, or
     * a table still eating, would leave cash and a bill belonging to a place
     * that can no longer take money — and no screen left to close them on.
     */
    private function refuseAKindThatDoesNotFit(Branch $branch, string $kind): void
    {
        if ($kind !== Branch::KIND_WAREHOUSE) {
            return;
        }

        if ($branch->is_default) {
            throw DomainException::unprocessable(
                'The main branch is where the business sells, so it cannot be a warehouse. Add the warehouse as its own place.',
                'MAIN_IS_A_SHOP',
            );
        }

        if (CashSession::query()->where('branch_id', $branch->id)->where('status', 'open')->exists()) {
            throw DomainException::conflict(
                "A till is still open at {$branch->name}. Close its shift first — a warehouse has no till.",
                'BRANCH_STILL_SELLING',
            );
        }

        if (RestaurantTicket::query()->where('branch_id', $branch->id)->where('status', RestaurantTicketStatus::Open)->exists()) {
            throw DomainException::conflict(
                "A table is still open at {$branch->name}. Settle or cancel it first — a warehouse serves nobody.",
                'BRANCH_STILL_SELLING',
            );
        }
    }

    /**
     * What is at a place that would have to be decided before it could go:
     * how much stock, how many people — and, where something has to be
     * FINISHED first, what.
     *
     * Asked by the Delete dialog before it asks anything of the owner, so the
     * choice it offers is about what is really there.
     */
    public function leaving(string $id): JsonResponse
    {
        /** @var Branch $branch */
        $branch = Branch::query()->findOrFail($id);

        try {
            $this->refuseWhatSomebodyMustFinish($branch, 'deleted');
            $blocked = null;
        } catch (DomainException $e) {
            $blocked = $e->getMessage();
        }

        return ApiResponse::ok(EmptyPlaceAction::holds($branch) + ['blocked' => $blocked]);
    }

    /**
     * Delete a place. Main can never go — a business keeps at least one.
     *
     * A place holding stock, or with people assigned to it, goes when the
     * request says what becomes of them: `stock` = move (to `stock_to`) or
     * discard, and `people_to` for the staff. Said nothing, it is refused as
     * before, with the reason.
     */
    public function destroy(DeleteBranchRequest $request, TenantContext $context, EmptyPlaceAction $empty, string $id): JsonResponse
    {
        /** @var Branch $branch */
        $branch = Branch::query()->findOrFail($id);
        $data = $request->validated();

        // What a person has to finish is refused before anything is moved.
        $this->refuseWhatSomebodyMustFinish($branch, 'deleted');

        DB::transaction(function () use ($context, $empty, $branch, $data): void {
            $empty->execute($context->get(), $branch, $data['stock'] ?? null, $data['stock_to'] ?? null, $data['people_to'] ?? null);

            // Whatever was not decided is still there, and still refuses.
            $this->refuseWhileStillInUse($branch, 'deleted');

            $branch->delete();
        });

        return ApiResponse::noContent($branch->isWarehouse() ? 'Warehouse deleted' : 'Branch deleted');
    }
}
