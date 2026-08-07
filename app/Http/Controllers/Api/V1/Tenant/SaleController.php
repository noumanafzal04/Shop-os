<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Sale\CancelSaleAction;
use App\Actions\Sale\CreateSaleAction;
use App\Actions\Sale\ProcessExchangeAction;
use App\Actions\Sale\ProcessSaleReturnAction;
use App\Enums\SaleChannel;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Sale\StoreExchangeRequest;
use App\Http\Requests\Sale\StoreSaleRequest;
use App\Http\Requests\Sale\StoreSaleReturnRequest;
use App\Models\Sale;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\CsvExport;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class SaleController extends Controller
{
    public function index(Request $request, BranchContext $branch): JsonResponse
    {
        $sales = Sale::query()
            ->withCount('items')
            ->with('branch:id,name')
            // Branch scope: a single branch (staff, or an owner focused on one)
            // sees only its sales; an owner's All-Branches view sees them all.
            ->when($branch->scopeId(), fn ($q, $b) => $q->where('branch_id', $b))
            ->when($request->query('search'), function ($q, $search): void {
                $q->where(function ($q) use ($search): void {
                    $q->where('invoice_number', 'like', "%{$search}%")
                        ->orWhere('customer_name', 'like', "%{$search}%")
                        ->orWhere('customer_phone', 'like', "%{$search}%");
                });
            })
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', $status))
            ->when($request->query('channel'), fn ($q, $channel) => $q->where('channel', $channel))
            ->when($request->query('from'), fn ($q, $from) => $q->where('sold_at', '>=', $from))
            ->when($request->query('to'), fn ($q, $to) => $q->where('sold_at', '<=', $to.' 23:59:59'))
            ->orderByDesc('sold_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated($sales);
    }

    /**
     * Export the sales ledger to CSV — honours the same search / status /
     * channel / date-range filters as index(), so "export this month's card
     * sales" is just the current filter plus a download.
     */
    public function export(Request $request, BranchContext $branch): StreamedResponse
    {
        $header = ['invoice_number', 'sold_at', 'branch', 'channel', 'status', 'customer_name', 'customer_phone', 'order_type', 'table_no', 'items', 'subtotal', 'discount', 'tax', 'total', 'payment_method', 'amount_paid', 'change_due', 'notes'];

        $rows = Sale::query()
            ->withCount('items')
            ->with('branch:id,name')
            ->when($branch->scopeId(), fn ($q, $b) => $q->where('branch_id', $b))
            ->when($request->query('search'), function ($q, $search): void {
                $q->where(function ($q) use ($search): void {
                    $q->where('invoice_number', 'like', "%{$search}%")
                        ->orWhere('customer_name', 'like', "%{$search}%")
                        ->orWhere('customer_phone', 'like', "%{$search}%");
                });
            })
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', $status))
            ->when($request->query('channel'), fn ($q, $channel) => $q->where('channel', $channel))
            ->when($request->query('from'), fn ($q, $from) => $q->where('sold_at', '>=', $from))
            ->when($request->query('to'), fn ($q, $to) => $q->where('sold_at', '<=', $to.' 23:59:59'))
            ->orderByDesc('sold_at')
            ->get()
            ->map(fn (Sale $s) => [
                $s->invoice_number,
                $s->sold_at?->toDateTimeString(),
                $s->branch?->name,
                $s->channel?->value,
                $s->status?->value,
                $s->customer_name,
                $s->customer_phone,
                $s->order_type,
                $s->table_no,
                $s->items_count,
                $s->subtotal,
                $s->discount,
                $s->tax,
                $s->total,
                $s->payment_method?->value,
                $s->amount_paid,
                $s->change_due,
                $s->notes,
            ])
            ->all();

        return CsvExport::stream('sales-'.now()->format('Y-m-d').'.csv', $header, $rows);
    }

    public function store(StoreSaleRequest $request, CreateSaleAction $action, TenantContext $tenant): JsonResponse
    {
        $data = $request->validated();

        // `pos_require_shift` shipped as a setting nothing read: a shop could
        // insist on shifts and still have counter sales rung with no drawer
        // attached, whose cash belongs to no reconciliation and shows up in no
        // shift report. Enforced here, on the counter channels only — an online
        // order or a phone order has no till to be open.
        $counterChannels = [SaleChannel::Pos->value, SaleChannel::WalkIn->value];
        if (
            empty($data['cash_session_id'])
            && in_array($data['channel'] ?? null, $counterChannels, true)
            && (bool) ($tenant->get()?->setting('pos_require_shift') ?? false)
        ) {
            throw DomainException::conflict(
                'Open a shift before ringing up a sale.',
                'SHIFT_REQUIRED',
            );
        }

        $sale = $action->execute($data);

        return ApiResponse::created($sale, "Sale {$sale->invoice_number} completed");
    }

    /**
     * One sale by id, practice included — a trainee reprinting the receipt they
     * just rang is the point of the exercise. Fetching by id is not a report:
     * the row says `is_training` and the receipt says TRAINING across it, so
     * nothing can be mistaken for real. Only LISTS and TOTALS stay fenced.
     */
    public function show(string $id): JsonResponse
    {
        return ApiResponse::ok(
            Sale::withTraining()->with(['items', 'returns.items', 'serials', 'tradeIns', 'payments'])->findOrFail($id),
        );
    }

    /** Full or partial return/refund — restocks through the inventory path. */
    public function processReturn(StoreSaleReturnRequest $request, string $id, ProcessSaleReturnAction $action): JsonResponse
    {
        $sale = Sale::query()->with('items')->findOrFail($id);
        $return = $action->execute($sale, $request->validated());

        return ApiResponse::created($return, "Refund {$return->return_number} processed");
    }

    /**
     * Exchange: return items from this sale and buy replacements in one step.
     * The returned value is credited to the new sale; the customer pays only
     * the difference. Returns { return, sale, difference }.
     */
    public function exchange(StoreExchangeRequest $request, string $id, ProcessExchangeAction $action): JsonResponse
    {
        $sale = Sale::query()->with('items')->findOrFail($id);
        $result = $action->execute($sale, $request->validated());

        return ApiResponse::created(
            $result,
            "Exchange completed — new sale {$result['sale']->invoice_number}",
        );
    }

    /**
     * Void a completed sale. Requires sales.void (see routes) and now a REASON
     * CODE from a fixed list.
     *
     * Free text alone was unreviewable: a manager scanning a week of voids could
     * not tell a mis-keyed item from a pattern, so the one control that catches
     * a ring-and-void — someone reading the void report — had nothing to read.
     * A fixed code makes voids countable per cashier; the note stays for detail.
     */
    public function cancel(Request $request, string $id, CancelSaleAction $action): JsonResponse
    {
        $data = $request->validate([
            'reason_code' => ['required', Rule::in(Sale::VOID_REASONS)],
            'reason' => ['nullable', 'string', 'max:255'],
        ]);

        $label = Sale::VOID_REASON_LABELS[$data['reason_code']] ?? $data['reason_code'];
        $note = $data['reason'] ?? null;

        $sale = $action->execute(
            Sale::query()->with('items')->findOrFail($id),
            $note === null ? $label : "{$label} — {$note}",
            $data['reason_code'],
        );

        return ApiResponse::ok($sale, 'Sale cancelled — stock restored');
    }

    // Receipts moved to ReceiptController: rendering one has to be logged
    // (original vs copy) and reported on, which is more than this controller
    // should carry.
}
