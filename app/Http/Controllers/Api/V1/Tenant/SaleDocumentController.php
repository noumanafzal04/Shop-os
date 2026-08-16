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
use Illuminate\Validation\Rule;

/**
 * Quotations and layaways — the counter's list of promises outstanding.
 */
class SaleDocumentController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            // Bound to the model's own list rather than spelled out. It was
            // spelled out, and adding a third kind left it unfilterable —
            // which is this codebase's recurring shape: capability built, one
            // link missing, nothing fails.
            'kind' => ['nullable', Rule::in(SaleDocument::KINDS)],
            // The bay board: what is in the shop right now.
            'work_status' => ['nullable', Rule::in(SaleDocument::WORK_STATUSES)],
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
            ->with([
                'items:id,sale_document_id,product_name,quantity,line_total',
                // The bay board prints a registration, not a uuid.
                'vehicle:id,registration,make,model',
            ])
            ->when($filters['kind'] ?? null, fn ($q, $kind) => $q->where('kind', $kind))
            ->when($filters['work_status'] ?? null, fn ($q, $w) => $q->where('work_status', $w))
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
        $enabled = match ($data['kind']) {
            SaleDocument::KIND_LAYAWAY => (bool) $tenant?->setting('layaway_enabled', true),
            // A workshop that can book a car in is a workshop. There is no
            // switch for it and there should not be one: the alternative to a
            // job card is a paper pad, not a tidier screen.
            SaleDocument::KIND_JOB_CARD => true,
            default => (bool) $tenant?->setting('quotations_enabled', true),
        };

        if (! $enabled) {
            throw DomainException::forbidden(
                $data['kind'] === SaleDocument::KIND_LAYAWAY
                    ? 'This shop does not hold goods on advance.'
                    : 'This shop does not issue quotations.',
                'DOCUMENT_KIND_DISABLED',
            );
        }

        $document = $action->execute($data);

        // Presented rather than raw: a job card carries the car, and a screen
        // that got back only a vehicle id would fetch the registration
        // separately just to print the row it already has.
        return ApiResponse::created(
            $this->present($document->load(['items', 'vehicle'])),
            match (true) {
                $document->isLayaway() => "Goods held · {$document->number}",
                $document->isJobCard() => "Job {$document->number} opened",
                default => "Quotation {$document->number} created",
            },
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

    /**
     * Move a car along the bay board.
     *
     * ── Why this is its own endpoint and not part of update ─────────────
     *
     * It is the one thing a workshop does twenty times a day, usually from a
     * phone, usually while holding something. It has to be one tap, and it must
     * not require sending back the lines, the customer or the totals — a
     * mechanic marking a car READY should not be able to change its price by
     * accident.
     *
     * ── Any stage, in any order ─────────────────────────────────────────
     *
     * Deliberately not a one-way lifecycle. Cars go backwards: a job marked
     * ready fails its road test and goes back on the ramp. Software that
     * refuses that teaches people to keep the real state on a whiteboard, and
     * then the screen is decoration.
     *
     * What IS refused is moving a job that is no longer live. A converted job
     * card has been paid for and the car has gone; a cancelled one never
     * happened. Changing either would put a car on the board that is not in
     * the shop.
     */
    public function workStatus(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'work_status' => ['required', Rule::in(SaleDocument::WORK_STATUSES)],
        ]);

        /** @var SaleDocument $document */
        $document = SaleDocument::query()->findOrFail($id);

        if (! $document->isJobCard()) {
            throw DomainException::unprocessable(
                'Only a job card moves through the workshop.',
                'NOT_A_JOB_CARD',
            );
        }

        if ($document->status !== SaleDocument::STATUS_OPEN) {
            throw DomainException::conflict(
                $document->status === SaleDocument::STATUS_CONVERTED
                    ? 'This job has been billed and the car has gone.'
                    : 'This job was cancelled.',
                'JOB_NOT_OPEN',
            );
        }

        $document->forceFill(['work_status' => $data['work_status']])->save();

        return ApiResponse::ok($this->present($document->fresh(['items', 'payments'])), 'Updated');
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
            // The car, when there is one. A job card that named a vehicle id
            // and nothing else would make the screen fetch every car one at a
            // time to print a registration.
            'vehicle' => $document->vehicle === null ? null : [
                'id' => $document->vehicle->id,
                'registration' => $document->vehicle->registration,
                'make' => $document->vehicle->make,
                'model' => $document->vehicle->model,
            ],
        ]);
    }
}
