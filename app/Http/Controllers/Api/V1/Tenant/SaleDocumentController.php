<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\SaleDocument\CancelSaleDocumentAction;
use App\Actions\SaleDocument\ConvertSaleDocumentAction;
use App\Actions\SaleDocument\CreateSaleDocumentAction;
use App\Actions\SaleDocument\RecordDepositAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\SaleDocument\CancelSaleDocumentRequest;
use App\Http\Requests\SaleDocument\ConvertSaleDocumentRequest;
use App\Http\Requests\SaleDocument\StoreDepositRequest;
use App\Http\Requests\SaleDocument\StoreSaleDocumentRequest;
use App\Models\SaleDocument;
use App\Support\ApiResponse;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Quotations and layaways — the counter's list of promises outstanding.
 */
class SaleDocumentController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'kind' => ['nullable', 'in:quotation,layaway'],
            // 'lapsed' is a filter, never a stored status — see
            // SaleDocument::hasLapsed().
            'status' => ['nullable', 'in:open,converted,cancelled,lapsed'],
            'search' => ['nullable', 'string', 'max:120'],
            'customer_id' => ['nullable', 'uuid'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = SaleDocument::query()
            ->with('items:id,sale_document_id,product_name,quantity,line_total')
            ->when($filters['kind'] ?? null, fn ($q, $kind) => $q->where('kind', $kind))
            ->when($filters['customer_id'] ?? null, fn ($q, $id) => $q->where('customer_id', $id))
            ->when($filters['from'] ?? null, fn ($q, $d) => $q->whereDate('created_at', '>=', $d))
            ->when($filters['to'] ?? null, fn ($q, $d) => $q->whereDate('created_at', '<=', $d))
            ->when($filters['search'] ?? null, function ($q, $term): void {
                $like = '%'.strtolower($term).'%';
                $q->where(function ($sub) use ($like): void {
                    $sub->whereRaw('LOWER(number) LIKE ?', [$like])
                        ->orWhereRaw('LOWER(customer_name) LIKE ?', [$like])
                        ->orWhere('customer_phone', 'like', $like);
                });
            });

        $status = $filters['status'] ?? null;
        if ($status === 'lapsed') {
            // Past the date and still open — a quote nobody came back for, or
            // goods sitting in the back room past their collect-by. This is the
            // list a shop should be phoning down.
            $query->where('status', SaleDocument::STATUS_OPEN)
                ->whereNotNull('expires_at')
                ->whereDate('expires_at', '<', today());
        } elseif ($status !== null) {
            $query->where('status', $status);
        }

        $documents = $query->orderByDesc('created_at')
            ->paginate($filters['per_page'] ?? 25);

        return ApiResponse::paginated($documents);
    }

    /**
     * The counter's headline numbers: how many promises are open, and — the one
     * that matters — how much of the shop's money is tied up in goods sitting
     * in the back room, and how much of the customers' money it is holding.
     */
    public function summary(): JsonResponse
    {
        $open = SaleDocument::query()->where('status', SaleDocument::STATUS_OPEN);

        $layaways = (clone $open)->where('kind', SaleDocument::KIND_LAYAWAY);
        $held = round((float) (clone $layaways)->sum('deposit_paid'), 2);
        $committed = round((float) (clone $layaways)->sum('total'), 2);

        return ApiResponse::ok([
            'open_quotations' => (int) (clone $open)->where('kind', SaleDocument::KIND_QUOTATION)->count(),
            'open_layaways' => (int) (clone $layaways)->count(),
            // Customers' money the shop is holding against goods not yet handed
            // over. It is in the till and it is not revenue.
            'deposits_held' => $held,
            // What those goods are worth in total, and therefore what is still
            // to be collected.
            'layaway_value' => $committed,
            'balance_outstanding' => round($committed - $held, 2),
            'overdue' => (int) (clone $open)
                ->whereNotNull('expires_at')
                ->whereDate('expires_at', '<', today())
                ->count(),
        ]);
    }

    public function store(StoreSaleDocumentRequest $request, CreateSaleDocumentAction $action, TenantContext $context): JsonResponse
    {
        $data = $request->validated();
        $tenant = $context->get();

        // The shop can switch either document off. Checked here rather than on
        // the route because it is a shop preference, not a plan entitlement.
        $enabled = $data['kind'] === SaleDocument::KIND_LAYAWAY
            ? (bool) $tenant?->setting('layaway_enabled', true)
            : (bool) $tenant?->setting('quotations_enabled', true);

        if (! $enabled) {
            throw DomainException::forbidden(
                $data['kind'] === SaleDocument::KIND_LAYAWAY
                    ? 'This shop does not hold goods on advance.'
                    : 'This shop does not issue quotations.',
                'DOCUMENT_KIND_DISABLED',
            );
        }

        $document = $action->execute($data);

        return ApiResponse::created(
            $document,
            $document->isLayaway()
                ? "Goods held · {$document->number}"
                : "Quotation {$document->number} created",
        );
    }

    public function show(string $id): JsonResponse
    {
        $document = SaleDocument::query()
            ->with(['items', 'payments' => fn ($q) => $q->orderBy('paid_at'), 'customer:id,name,phone', 'sale:id,invoice_number,sold_at'])
            ->findOrFail($id);

        return ApiResponse::ok($this->present($document));
    }

    /** Another instalment against a layaway. */
    public function deposit(StoreDepositRequest $request, RecordDepositAction $action, string $id): JsonResponse
    {
        $document = SaleDocument::query()->findOrFail($id);
        $payment = $action->execute($document, $request->validated());

        return ApiResponse::created([
            'payment' => $payment,
            'document' => $this->present($document->fresh(['items', 'payments'])),
        ], 'Advance recorded');
    }

    /** Bill it: the goods go out and a real sale is rung. */
    public function convert(ConvertSaleDocumentRequest $request, ConvertSaleDocumentAction $action, string $id): JsonResponse
    {
        $document = SaleDocument::query()->findOrFail($id);
        $sale = $action->execute($document, $request->validated());

        return ApiResponse::created([
            'sale' => $sale->load(['items', 'payments']),
            'document' => $this->present($document->fresh(['items', 'payments'])),
        ], "Billed as {$sale->invoice_number}");
    }

    public function cancel(CancelSaleDocumentRequest $request, CancelSaleDocumentAction $action, string $id): JsonResponse
    {
        $document = SaleDocument::query()->findOrFail($id);

        // Cancelling a layaway hands money back and returns stock — refund
        // authority, not sales authority. A quotation cancel moves nothing.
        if ($document->isLayaway() && (float) $document->deposit_paid > 0
            && ! $request->user()->hasPermission(Permissions::SALES_REFUND)) {
            throw DomainException::forbidden(
                'Returning an advance needs refund permission — ask a manager.',
                'REFUND_PERMISSION_REQUIRED',
            );
        }

        $cancelled = $action->execute($document, $request->validated());

        return ApiResponse::ok($this->present($cancelled), "{$cancelled->number} cancelled");
    }

    /**
     * The paper the customer takes away.
     *
     * Not logged the way a receipt is: a receipt copy is a control problem
     * (it's evidence of a sale), while re-printing an estimate for a customer
     * who mislaid it is just service. Nothing has been sold yet, so there is
     * nothing to launder.
     */
    public function print(Request $request, string $id, TenantContext $context): Response
    {
        $data = $request->validate([
            // An estimate on a curl of 58mm thermal isn't something anyone
            // files, so a shop can force a sheet regardless of the till's roll.
            'paper' => ['sometimes', 'in:standard,thermal_80,thermal_58'],
        ]);

        $document = SaleDocument::query()
            ->with(['items', 'payments' => fn ($q) => $q->orderBy('paid_at'), 'branch:id,name'])
            ->findOrFail($id);

        $tenant = $context->get();

        return response()->view('documents.show', [
            'document' => $document,
            'tenant' => $tenant,
            'settings' => $tenant->allSettings(),
            'paper' => $data['paper'] ?? null,
        ]);
    }

    /**
     * The derived numbers a client would otherwise have to recompute — and get
     * subtly wrong on the day the rules change.
     */
    private function present(SaleDocument $document): array
    {
        return array_merge($document->toArray(), [
            'balance' => $document->balance(),
            'has_lapsed' => $document->hasLapsed(),
        ]);
    }
}
