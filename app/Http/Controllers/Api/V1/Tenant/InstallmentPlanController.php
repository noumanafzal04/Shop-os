<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Installment\StartInstallmentPlanAction;
use App\Actions\Installment\TakeInstallmentAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Installment\StartInstallmentPlanRequest;
use App\Http\Requests\Installment\TakeInstallmentRequest;
use App\Models\Customer;
use App\Models\CustomerLedgerEntry;
use App\Models\InstallmentPlan;
use App\Support\ApiResponse;
use App\Support\ShopDay;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Goods on installments (F1): the list a shop follows them on, one plan month
 * by month, starting one, and taking an installment.
 */
class InstallmentPlanController extends Controller
{
    /**
     * The list's filters. `due_soon`, `this_month` and `late` are worked out
     * from the schedule on the day asked, never stored; `all` is every plan.
     */
    public const FILTERS = ['running', 'due_soon', 'this_month', 'late', 'paid_off', 'closed', 'all'];

    public function index(Request $request): JsonResponse
    {
        $f = $request->validate([
            'status' => ['nullable', Rule::in(self::FILTERS)],
            'search' => ['nullable', 'string', 'max:120'],
            'customer_id' => ['nullable', 'uuid'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = InstallmentPlan::query()
            ->with(['sale:id,invoice_number', 'sale.items:id,sale_id,product_name,quantity'])
            ->when($f['customer_id'] ?? null, fn ($q, $id) => $q->where('customer_id', $id))
            // A plan is asked for by its number, the customer's name or phone,
            // the bill's invoice number, or what went home ("the fridge").
            ->when($f['search'] ?? null, function ($q, $term): void {
                $like = '%'.strtolower($term).'%';
                $q->where(fn ($s) => $s->whereRaw('LOWER(number) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(customer_name) LIKE ?', [$like])
                    ->orWhere('customer_phone', 'like', $like)
                    ->orWhereHas('sale', fn ($sale) => $sale->whereRaw('LOWER(invoice_number) LIKE ?', [$like]))
                    ->orWhereHas('sale.items', fn ($item) => $item->whereRaw('LOWER(product_name) LIKE ?', [$like])));
            });

        // Whoever has waited longest comes first: the oldest unpaid month.
        match ($f['status'] ?? 'all') {
            'running' => $query->running()->orderBy('next_due_on'),
            'due_soon' => $query->dueSoon()->orderBy('next_due_on'),
            'this_month' => $query->dueThisMonth()->orderBy('next_due_on'),
            'late' => $query->late()->orderBy('next_due_on'),
            'paid_off' => $query->where('status', InstallmentPlan::STATUS_PAID_OFF)->orderByDesc('paid_off_at'),
            'closed' => $query->where('status', InstallmentPlan::STATUS_CLOSED)->orderByDesc('updated_at'),
            default => $query->orderByDesc('created_at'),
        };

        $page = $query->stably()->paginate($f['per_page'] ?? 25);
        $today = ShopDay::calendarToday();
        $page->setCollection($page->getCollection()->map(fn (InstallmentPlan $p) => $this->present($p, $today)));

        return ApiResponse::paginated($page);
    }

    /**
     * The headline: what is out on installments, what is late, what is still
     * to come this month (late and this month never count one rupee twice),
     * what came in this month — and the counts on the filters, each asked
     * with its filter's own scope.
     */
    public function summary(): JsonResponse
    {
        $today = ShopDay::calendarToday();
        $out = $late = $dueThisMonth = 0.0;
        $lateCount = 0;

        foreach (InstallmentPlan::query()->running()->get() as $plan) {
            $standing = $plan->schedule($today);
            $out += $standing['left'];
            if ($standing['late'] > 0) {
                $lateCount++;
                $late += $standing['late'];
            }
            $dueThisMonth += $plan->owedThisMonth($today);
        }

        // Installments paid in this month — money, so a return or a
        // cancellation of the goods is not a collection.
        $collected = (float) CustomerLedgerEntry::query()
            ->where('type', 'payment')
            ->whereNotIn('method', Customer::NOT_COLLECTIONS)
            ->whereIn('sale_id', InstallmentPlan::query()->whereNotNull('sale_id')->select('sale_id'))
            ->where('created_at', '>=', ShopDay::startOf(CarbonImmutable::parse($today)->startOfMonth()->toDateString()))
            ->sum('amount');

        return ApiResponse::ok([
            'out' => round($out, 2),
            'due_this_month' => round($dueThisMonth, 2),
            'late' => ['total' => round($late, 2), 'plans' => $lateCount],
            'collected_this_month' => round($collected, 2),
            'counts' => [
                'running' => InstallmentPlan::query()->running()->count(),
                'due_soon' => InstallmentPlan::query()->dueSoon($today)->count(),
                'this_month' => InstallmentPlan::query()->dueThisMonth($today)->count(),
                'late' => InstallmentPlan::query()->late($today)->count(),
                'paid_off' => InstallmentPlan::query()->where('status', InstallmentPlan::STATUS_PAID_OFF)->count(),
                'closed' => InstallmentPlan::query()->where('status', InstallmentPlan::STATUS_CLOSED)->count(),
                'all' => InstallmentPlan::query()->count(),
            ],
        ]);
    }

    public function show(string $id): JsonResponse
    {
        /** @var InstallmentPlan $plan */
        $plan = InstallmentPlan::query()
            ->with(['sale:id,invoice_number,sold_at', 'sale.items:id,sale_id,product_name,quantity,line_total'])
            ->findOrFail($id);

        $payments = $plan->payments()
            ->with('takenBy:id,name')
            ->orderBy('created_at')->orderBy('id')
            ->get(['id', 'amount', 'method', 'reference', 'note', 'created_by', 'created_at']);
        $returned = $payments->filter(fn (CustomerLedgerEntry $e) => in_array($e->method, Customer::NOT_COLLECTIONS, true));

        return ApiResponse::ok($this->present($plan, ShopDay::calendarToday(), withMonths: true) + [
            // What the customer has actually paid since the advance, and what
            // came off by the goods coming back — never one figure for both.
            'collected' => round((float) $payments->sum('amount') - (float) $returned->sum('amount'), 2),
            'returned' => round((float) $returned->sum('amount'), 2),
            'payments' => $payments->map(fn (CustomerLedgerEntry $e) => [
                'id' => $e->id,
                'amount' => round((float) $e->amount, 2),
                'method' => $e->method,
                'reference' => $e->reference,
                'at' => $e->created_at?->toIso8601String(),
                'taken_by' => $e->takenBy?->name,
            ])->all(),
        ]);
    }

    public function store(StartInstallmentPlanRequest $request, StartInstallmentPlanAction $action, TenantContext $context): JsonResponse
    {
        if (! (bool) $context->get()?->setting('installments_enabled', true)) {
            throw DomainException::forbidden('This shop does not sell on installments.', 'INSTALLMENTS_DISABLED');
        }

        $plan = $action->execute($request->validated());

        return ApiResponse::created($this->present($plan->fresh(['sale:id,invoice_number', 'sale.items:id,sale_id,product_name,quantity']), ShopDay::calendarToday(), withMonths: true), "Plan {$plan->number} started");
    }

    public function pay(TakeInstallmentRequest $request, TakeInstallmentAction $action, string $id): JsonResponse
    {
        $plan = InstallmentPlan::query()->findOrFail($id);
        $entry = $action->execute($plan, $request->user(), $request->validated());

        return ApiResponse::created([
            'entry' => $entry,
            'plan' => $this->present($plan->fresh(['sale:id,invoice_number']), ShopDay::calendarToday(), withMonths: true),
        ], 'Installment recorded');
    }

    /** A plan, with where it stands today — so no screen works the schedule out again. */
    private function present(InstallmentPlan $plan, string $today, bool $withMonths = false): array
    {
        $standing = $plan->schedule($today);
        if (! $withMonths) {
            unset($standing['rows']);
        }

        return array_merge($plan->toArray(), [
            'items' => $plan->sale?->items?->map(fn ($i) => ['name' => $i->product_name, 'quantity' => (float) $i->quantity])->all() ?? [],
            'standing' => $standing,
        ]);
    }
}
