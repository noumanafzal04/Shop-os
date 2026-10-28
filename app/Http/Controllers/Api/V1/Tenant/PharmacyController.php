<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Enums\SaleStatus;
use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SaleReturn;
use App\Models\StockMovement;
use App\Models\User;
use App\Support\ApiResponse;
use App\Support\ShopDay;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The three things a chemist does that no other shop does.
 *
 * Substituting a brand for its generic, keeping a register of what was
 * dispensed against whose prescription, and — when a manufacturer withdraws a
 * batch — finding the people who took it home. The first is a counter action;
 * the other two are the shop's answer when someone official asks.
 */
class PharmacyController extends Controller
{
    /**
     * Same salt, on the shelf.
     *
     * The brand on the prescription is out and the customer is standing there.
     * Matching is on generic_name — the molecule — because that is what makes
     * two boxes interchangeable; strength is reported but NOT required to
     * match, since 2 × 250mg is a real answer a pharmacist can give and
     * silently hiding it would be worse than showing it with its strength.
     */
    public function alternatives(Request $request): JsonResponse
    {
        $data = $request->validate([
            'product_id' => ['required', 'uuid'],
            'in_stock_only' => ['sometimes', 'boolean'],
        ]);

        /** @var Product $source */
        $source = Product::query()->findOrFail($data['product_id']);

        if (blank($source->generic_name)) {
            // Nothing to match on. Say so rather than returning an empty list
            // that reads as "no alternatives exist".
            return ApiResponse::ok([
                'source' => $this->drug($source),
                'reason' => 'no_generic_name',
                'alternatives' => [],
            ], 'This item has no generic name recorded, so equivalents can\'t be found.');
        }

        $alternatives = Product::query()
            ->where('is_active', true)
            ->whereKeyNot($source->id)
            ->whereRaw('LOWER(generic_name) = ?', [mb_strtolower(trim($source->generic_name))])
            ->when($request->boolean('in_stock_only', true), fn ($q) => $q->where('stock_quantity', '>', 0))
            ->orderByDesc('stock_quantity')
            ->limit(25)
            ->get()
            ->map(fn (Product $p) => [
                ...$this->drug($p),
                // Flagged, not filtered: a different strength is often still
                // the right answer, but the pharmacist must SEE that it differs.
                'same_strength' => $this->normalise($p->strength) === $this->normalise($source->strength),
                'same_form' => $this->normalise($p->dosage_form) === $this->normalise($source->dosage_form),
            ]);

        return ApiResponse::ok([
            'source' => $this->drug($source),
            'reason' => null,
            'alternatives' => $alternatives->values(),
        ]);
    }

    /**
     * The dispensing register: every prescription-only item that left the shop,
     * with the prescription it left on and the lot it came from.
     *
     * Derived from the sales themselves rather than kept as a second ledger —
     * a register that can disagree with the till is worse than no register.
     */
    public function dispensing(Request $request): JsonResponse
    {
        $data = $request->validate([
            'from' => ['sometimes', 'nullable', 'date'],
            'to' => ['sometimes', 'nullable', 'date'],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'controlled_only' => ['sometimes', 'boolean'],
        ]);

        $window = ShopDay::window($data['from'] ?? null, $data['to'] ?? null, 'month');
        $from = $window['from'];
        $to = $window['to'];

        $sales = Sale::query()
            ->whereBetween('sold_at', [$window['start'], $window['end']])
            ->where('status', '!=', SaleStatus::Cancelled)
            ->when(! empty($data['search']), function ($q) use ($data): void {
                $term = '%'.$data['search'].'%';
                $q->where(fn ($w) => $w->where('patient_name', 'like', $term)
                    ->orWhere('prescriber_name', 'like', $term)
                    ->orWhere('prescription_number', 'like', $term)
                    ->orWhere('customer_name', 'like', $term)
                    ->orWhere('invoice_number', 'like', $term));
            })
            ->orderByDesc('sold_at')
            ->limit(500)
            ->get();

        if ($sales->isEmpty()) {
            return ApiResponse::ok(['from' => $from, 'to' => $to, 'rows' => []]);
        }

        // A controlled drug is the narrower register a regulator asks for; the
        // default is everything prescription-only, which is what a pharmacist
        // means by "what did we dispense".
        $controlledOnly = (bool) ($data['controlled_only'] ?? false);

        $items = SaleItem::query()
            ->with(['product:id,name,generic_name,strength,dosage_form,requires_prescription,drug_schedule'])
            ->whereIn('sale_id', $sales->pluck('id'))
            ->get()
            ->filter(function (SaleItem $item) use ($controlledOnly): bool {
                $product = $item->product;
                if ($product === null) {
                    return false;
                }

                return $controlledOnly
                    ? filled($product->drug_schedule)
                    : $product->requires_prescription || filled($product->drug_schedule);
            });

        // The lots each line came from, looked up once for the whole page.
        $allocations = StockMovement::query()
            ->where('reference_type', 'sale')
            ->whereIn('reference_id', $sales->pluck('id'))
            ->whereNotNull('batch_allocations')
            ->get(['reference_id', 'product_id', 'batch_allocations'])
            ->groupBy(fn ($m) => $m->reference_id.'|'.$m->product_id);

        $salesById = $sales->keyBy('id');

        // WHO handed it over — the regulator's second question (#PH6). The
        // sale already knows who rang it; the register never said.
        $staff = User::query()->whereIn('id', $sales->pluck('created_by')->filter()->unique())->pluck('name', 'id');

        $rows = $items->map(function (SaleItem $item) use ($salesById, $allocations, $staff): array {
            $sale = $salesById->get($item->sale_id);
            $lots = $allocations->get($item->sale_id.'|'.$item->product_id, collect())
                ->flatMap(fn ($m) => $m->batch_allocations ?? [])
                ->all();

            return [
                'sale_id' => $item->sale_id,
                'invoice_number' => $sale?->invoice_number,
                'dispensed_at' => $sale?->sold_at?->toIso8601String(),
                'drug' => $item->product_name,
                'generic_name' => $item->product?->generic_name,
                'strength' => $item->product?->strength,
                'dosage_form' => $item->product?->dosage_form,
                'schedule' => $item->product?->drug_schedule,
                'quantity' => (float) $item->quantity,
                'batches' => $lots,
                // The prescription this was dispensed against. Captured on the
                // sale, so it covers every line on that prescription at once.
                'prescription_number' => $sale?->prescription_number,
                'patient_name' => $sale?->patient_name ?: $sale?->customer_name,
                'prescriber_name' => $sale?->prescriber_name,
                'customer_phone' => $sale?->customer_phone,
                'dispensed_by' => $staff[$sale?->created_by] ?? null,
            ];
        })->values();

        return ApiResponse::ok([
            'from' => $from,
            'to' => $to,
            'rows' => $rows,
        ]);
    }

    /**
     * Batch recall: who took home the bad stock.
     *
     * Answers the only question that matters in a withdrawal — the customers to
     * telephone — plus what is still on the shelf to pull. Matching is on the
     * batch NUMBER rather than the batch row id, because a recall notice names
     * a manufacturer's lot, and the same lot can have been received more than
     * once across branches.
     */
    public function recall(Request $request): JsonResponse
    {
        $data = $request->validate([
            'batch_number' => ['required', 'string', 'max:100'],
        ]);

        $needle = mb_strtolower(trim($data['batch_number']));

        // A JSON LIKE is deliberate: the allocation set per movement is tiny,
        // and this runs once during an incident, never on a hot path.
        //
        // LOWER on BOTH SIDES, and this is not tidiness. The pre-filter used
        // the manufacturer's casing as typed while the authoritative match
        // below lowercases, so on MySQL — where a LIKE against a JSON column
        // compares binary — a lot received as "Bad-77" and recalled as
        // "BAD-77" matched NOTHING. SQLite's LIKE is case-insensitive for
        // ASCII, so every test agreed it worked.
        //
        // The failure was the bad kind: `on_hand` below already lowercases, so
        // a recall would correctly list the stock to pull off the shelf and
        // show an EMPTY list of people who had already taken it home. A screen
        // that looks like it worked is how somebody stops looking.
        $movements = StockMovement::query()
            ->whereNotNull('batch_allocations')
            ->whereRaw('LOWER(batch_allocations) LIKE ?', ['%'.$needle.'%'])
            ->get();

        $matched = $movements->filter(fn (StockMovement $m) => collect($m->batch_allocations ?? [])
            ->contains(fn ($a) => mb_strtolower(trim((string) ($a['batch_number'] ?? ''))) === $needle));

        $saleIds = $matched->where('reference_type', 'sale')->pluck('reference_id')->filter()->unique();

        $quantityFor = fn (StockMovement $m) => collect($m->batch_allocations ?? [])
            ->filter(fn ($a) => mb_strtolower(trim((string) ($a['batch_number'] ?? ''))) === $needle)
            ->sum(fn ($a) => (float) ($a['quantity'] ?? 0));

        // What is STILL with the customer, not what was once sold (#PH4). A
        // refunded box is back on the shelf — inside the very `on_hand` this
        // screen says to pull — so calling its buyer was a wasted call, and
        // shelf + "out there" added up to more than the lot ever held.
        //
        // A return puts its tablets into the earliest-expiring lot, so its
        // movement names no lot. When a sale drew on two lots the return is
        // counted against the OTHER lot first: a recall that rings a customer
        // twice is cheap, one that misses a customer is not.
        $key = fn (StockMovement $m, string $saleId) => $saleId.'|'.$m->product_id.'|'.$m->variant_id;
        $returnedTo = SaleReturn::query()->whereIn('sale_id', $saleIds)->pluck('sale_id', 'id');
        $returned = StockMovement::query()
            ->where('reference_type', 'sale_return')
            ->whereIn('reference_id', $returnedTo->keys())
            ->get()
            ->groupBy(fn (StockMovement $m) => $key($m, $returnedTo[$m->reference_id]))
            ->map(fn ($ms) => $ms->sum(fn (StockMovement $m) => abs((float) $m->quantity_change)));
        $sold = StockMovement::query()
            ->where('reference_type', 'sale')
            ->whereIn('reference_id', $saleIds)
            ->get()
            ->groupBy(fn (StockMovement $m) => $key($m, $m->reference_id))
            ->map(fn ($ms) => $ms->sum(fn (StockMovement $m) => abs((float) $m->quantity_change)));

        $stillOut = $matched->where('reference_type', 'sale')
            ->groupBy(fn (StockMovement $m) => $key($m, $m->reference_id))
            ->map(fn ($ms, $k) => max(0, min(
                $ms->sum($quantityFor),
                ($sold[$k] ?? 0) - ($returned[$k] ?? 0),
            )))
            ->groupBy(fn ($qty, $k) => explode('|', $k)[0], preserveKeys: true)
            ->map(fn ($qtys) => round((float) $qtys->sum(), 3))
            ->filter(fn ($qty) => $qty > 0);

        $sales = Sale::query()
            ->whereIn('id', $stillOut->keys())
            ->where('status', '!=', SaleStatus::Cancelled)
            ->orderByDesc('sold_at')
            ->get(['id', 'invoice_number', 'sold_at', 'customer_name', 'customer_phone', 'patient_name', 'prescriber_name', 'prescription_number']);

        // Still on the shelf: what a recall actually pulls first.
        $onHand = ProductBatch::query()
            ->whereRaw('LOWER(batch_number) = ?', [$needle])
            ->where('quantity', '>', 0)
            ->with('product:id,name')
            ->get()
            ->map(fn ($b) => [
                'product_id' => $b->product_id,
                'product_name' => $b->product?->name,
                'branch_id' => $b->branch_id,
                'expiry_date' => $b->expiry_date?->toDateString(),
                'quantity' => (float) $b->quantity,
            ]);

        return ApiResponse::ok([
            'batch_number' => $data['batch_number'],
            'on_hand' => $onHand->values(),
            'dispensed' => $sales->map(fn (Sale $s) => [
                'sale_id' => $s->id,
                'invoice_number' => $s->invoice_number,
                'sold_at' => $s->sold_at?->toIso8601String(),
                // The point of the whole endpoint: someone to telephone.
                'customer_name' => $s->patient_name ?: $s->customer_name,
                'customer_phone' => $s->customer_phone,
                'prescriber_name' => $s->prescriber_name,
                'prescription_number' => $s->prescription_number,
                'quantity' => $stillOut[$s->id],
            ])->values(),
            // A sale with no phone number cannot be reached — surfacing the
            // count stops that being discovered halfway down the list.
            'unreachable' => $sales->whereNull('customer_phone')->count(),
        ]);
    }

    /** @return array<string, mixed> */
    private function drug(Product $p): array
    {
        return [
            'id' => $p->id,
            'name' => $p->name,
            'brand' => $p->brand,
            'generic_name' => $p->generic_name,
            'strength' => $p->strength,
            'dosage_form' => $p->dosage_form,
            'schedule' => $p->drug_schedule,
            'requires_prescription' => (bool) $p->requires_prescription,
            'price' => (float) $p->price,
            'stock_quantity' => (float) $p->stock_quantity,
        ];
    }

    /** Compare "500 MG" and "500mg" as the same thing. */
    private function normalise(?string $value): string
    {
        return preg_replace('/\s+/', '', mb_strtolower(trim((string) $value))) ?? '';
    }
}
