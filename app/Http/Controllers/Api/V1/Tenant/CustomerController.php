<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Customer\TakeKhataPaymentAction;
use App\Enums\SaleStatus;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Customer\RecordCustomerPaymentRequest;
use App\Http\Requests\Customer\StoreCustomerRequest;
use App\Http\Requests\Customer\UpdateCustomerRequest;
use App\Models\Customer;
use App\Models\InstallmentPlan;
use App\Models\Order;
use App\Support\ApiResponse;
use App\Support\CsvExport;
use App\Support\ShopDay;
use App\Support\ShopTime;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class CustomerController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $standing = $this->standing($request);

        $customers = Customer::query()
            ->withCount(['sales as sales_count' => fn ($q) => $q->where('status', '!=', SaleStatus::Cancelled->value)])
            ->withSum(['sales as sales_total' => fn ($q) => $q->where('status', '!=', SaleStatus::Cancelled->value)], 'total')
            // When they last handed money over — a khata nobody has paid into
            // for six weeks is the one to phone.
            ->withMax('khataPayments as last_paid_at', 'created_at')
            ->when($request->query('search'), fn ($q, $s) => $q->where(function ($q) use ($s): void {
                $q->where('name', 'like', "%{$s}%")->orWhere('phone', 'like', "%{$s}%")->orWhere('email', 'like', "%{$s}%");
            }))
            ->standing($standing)
            ->orderByDesc('last_seen_at')
            ->stably()->paginate(min((int) $request->query('per_page', 20), 100));

        return ApiResponse::paginated($customers);
    }

    /**
     * The counts on the list's filters, and what is out on khata.
     *
     * `owed` is the dashboard's "Owed to you" figure, asked the same way
     * (every balance above zero), so the tile and the list cannot disagree.
     */
    public function summary(): JsonResponse
    {
        $row = Customer::query()->toBase()->selectRaw(
            'COUNT(*) AS everyone,
             COALESCE(SUM(CASE WHEN credit_balance > 0 THEN credit_balance END), 0) AS owed,
             COUNT(CASE WHEN credit_balance > 0 THEN 1 END) AS owing,
             COALESCE(SUM(CASE WHEN credit_balance < 0 THEN -credit_balance END), 0) AS held,
             COUNT(CASE WHEN credit_balance < 0 THEN 1 END) AS in_credit,
             COUNT(CASE WHEN credit_balance > 0 AND credit_limit > 0 AND credit_balance >= credit_limit * ? THEN 1 END) AS near_limit',
            [Customer::NEAR_LIMIT],
        )->first();

        return ApiResponse::ok([
            'everyone' => (int) $row->everyone,
            'owed' => ['total' => round((float) $row->owed, 2), 'accounts' => (int) $row->owing],
            'advance' => ['total' => round((float) $row->held, 2), 'accounts' => (int) $row->in_credit],
            'near_limit' => (int) $row->near_limit,
            'installments' => Customer::query()->standing(Customer::STANDING_INSTALLMENTS)->count(),
            'late_installments' => Customer::query()->standing(Customer::STANDING_LATE)->count(),
        ]);
    }

    private function standing(Request $request): ?string
    {
        return $request->validate([
            'standing' => ['nullable', Rule::in(Customer::STANDINGS)],
        ])['standing'] ?? null;
    }

    /** Export the customer directory to CSV — honours the list's search and filter. */
    public function export(Request $request): StreamedResponse
    {
        $header = ['name', 'phone', 'email', 'address', 'credit_balance', 'credit_limit', 'sales_count', 'total_spent', 'last_seen_at', 'notes'];

        $rows = Customer::query()
            ->withCount(['sales as sales_count' => fn ($q) => $q->where('status', '!=', SaleStatus::Cancelled->value)])
            ->withSum(['sales as sales_total' => fn ($q) => $q->where('status', '!=', SaleStatus::Cancelled->value)], 'total')
            ->when($request->query('search'), fn ($q, $s) => $q->where(function ($q) use ($s): void {
                $q->where('name', 'like', "%{$s}%")->orWhere('phone', 'like', "%{$s}%")->orWhere('email', 'like', "%{$s}%");
            }))
            // The file is the list on the screen: a filter chosen there is kept.
            ->standing($this->standing($request))
            ->orderBy('name')
            ->get()
            ->map(fn (Customer $c) => [
                $c->name,
                $c->phone,
                $c->email,
                $c->address,
                $c->credit_balance,
                $c->credit_limit,
                $c->sales_count,
                $c->sales_total ?? 0,
                ShopTime::show($c->last_seen_at, 'Y-m-d H:i:s'),
                $c->notes,
            ])
            ->all();

        return CsvExport::stream('customers-'.ShopTime::show(now(), 'Y-m-d').'.csv', $header, $rows);
    }

    public function store(StoreCustomerRequest $request): JsonResponse
    {
        $customer = Customer::query()->create($request->validated());

        return ApiResponse::created($customer, 'Customer added');
    }

    /**
     * POS lookup by phone: the till shows the customer's loyalty points +
     * credit so the cashier can redeem/charge. Returns null data (200, not
     * 404) when no CRM record exists yet — a first-time walk-in is normal.
     */
    public function lookup(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        if ($q !== '') {
            return ApiResponse::ok(Customer::suggest((string) app(TenantContext::class)->id(), $q));
        }

        $phone = trim((string) $request->query('phone', ''));
        if ($phone === '') {
            return ApiResponse::ok(null);
        }

        $customer = Customer::byPhone((string) app(TenantContext::class)->id(), $phone);

        /*
         * WHAT THE GROUP WILL DO TO THE BILL.
         *
         * A sale reads the customer's group off this same phone number and
         * acts on it twice: it prices unmarked lines at the group's level and
         * takes the group's percentage off the bill. The till was told
         * neither, so it showed a member the full retail figure, the cashier
         * read it out, the card was charged it — and the sale then recorded
         * the lower one with the difference as "change" nobody was handed.
         *
         * Resolved exactly as CreateSaleAction resolves it (`->group`, no
         * extra conditions), because a till told about a group the sale
         * would not apply is the same bug in the other direction.
         */
        $group = $customer?->group;

        return ApiResponse::ok($customer === null ? null : [
            'id' => $customer->id,
            'name' => $customer->name,
            'phone' => $customer->phone,
            'loyalty_points' => (int) $customer->loyalty_points,
            'credit_balance' => (float) $customer->credit_balance,
            'credit_limit' => $customer->credit_limit !== null ? (float) $customer->credit_limit : null,
            'group' => $group === null ? null : [
                'id' => $group->id,
                'name' => $group->name,
                'price_level' => $group->price_level === 'wholesale' ? 'wholesale' : 'retail',
                'discount_percent' => $group->discount_percent !== null ? (float) $group->discount_percent : 0.0,
            ],
        ]);
    }

    public function show(string $id): JsonResponse
    {
        /** @var Customer $customer */
        $customer = Customer::query()->findOrFail($id);

        // Walk-in sales are linked; online orders match by phone snapshot.
        $sales = $customer->sales()->where('status', '!=', SaleStatus::Cancelled->value)
            ->latest('sold_at')->limit(50)->get(['id', 'invoice_number', 'total', 'channel', 'sold_at']);

        $orders = $customer->phone
            ? Order::query()->where('customer_phone', $customer->phone)
                ->latest('placed_at')->limit(50)->get(['id', 'order_number', 'total', 'status', 'placed_at'])
            : collect();

        $customer->setAttribute('history', [
            'sales' => $sales,
            'orders' => $orders,
            'total_spent' => round((float) $sales->sum('total') + (float) $orders->sum('total'), 2),
            'orders_count' => $sales->count() + $orders->count(),
        ]);

        // Khata statement — most recent ledger movements, each with the
        // invoice it belongs to, so a credit sale on the statement opens; and
        // the plan, when the sale went home on installments — so the goods,
        // the installment charge and each installment read as what they are,
        // not as one more "credit sale" and "paid".
        $planOf = $customer->installmentPlans()->whereNotNull('sale_id')->pluck('number', 'sale_id');
        $customer->setAttribute('ledger', $customer->ledgerEntries()->with('sale:id,invoice_number')->limit(50)->get()
            ->each(fn ($entry) => $entry->setAttribute('plan', $entry->sale_id === null ? null : ($planOf[$entry->sale_id] ?? null))));
        // Goods on installments — the ones still being paid for first, each
        // with where it stands today (F1).
        $today = ShopDay::calendarToday();
        $customer->setAttribute('installment_plans', $customer->installmentPlans()
            ->orderByRaw("CASE WHEN status = 'running' THEN 0 ELSE 1 END")->orderByDesc('created_at')->limit(20)->get()
            ->map(fn (InstallmentPlan $p) => [
                'id' => $p->id, 'number' => $p->number, 'status' => $p->status,
                'total' => (float) $p->total, 'monthly' => (float) $p->monthly, 'months' => $p->months,
                'next_due_on' => $p->next_due_on?->toDateString(),
            ] + array_intersect_key($p->schedule($today), array_flip(['left', 'late', 'late_months', 'due_now', 'months_paid']))));

        // Loyalty statement — most recent points movements.
        $customer->setAttribute('loyalty_ledger', $customer->loyaltyEntries()->limit(50)->get());

        return ApiResponse::ok($customer);
    }

    /**
     * Record a repayment against the customer's khata (credit balance).
     */
    public function recordPayment(RecordCustomerPaymentRequest $request, TakeKhataPaymentAction $payments, string $id): JsonResponse
    {
        /** @var Customer $customer */
        $customer = Customer::query()->findOrFail($id);
        $data = $request->validated();

        // Overpaying the khata pushes the balance negative — a legitimate
        // advance in the customer's favour, but it must be DELIBERATE. Without
        // an explicit allow_advance the extra is refused instead of silently
        // banked against a paid-off account (which used to happen unremarked).
        $amount = (float) $data['amount'];
        $outstanding = max(0.0, (float) $customer->credit_balance);
        if ($amount > $outstanding + 0.001 && empty($data['allow_advance'])) {
            throw DomainException::unprocessable(
                $outstanding > 0
                    ? 'Payment exceeds the '.number_format($outstanding, 2).' still owed. Confirm to keep the extra '.number_format($amount - $outstanding, 2).' as an advance.'
                    : 'This customer owes nothing. Confirm to record this as an advance.',
                'KHATA_OVERPAYMENT',
            );
        }

        // Khata collected in CASH physically lands in whichever drawer the
        // cashier has open (`khata_in`) — until that was recorded it produced a
        // phantom OVERAGE at close. And it needs that drawer: without today's
        // shift, in a shop that asks for one, it is refused (L18).
        $entry = $payments->execute(
            $customer,
            $request->user(),
            $amount,
            $data['method'],
            $data['reference'] ?? null,
            $data['note'] ?? null,
        );

        return ApiResponse::created([
            'entry' => $entry,
            'credit_balance' => (float) $customer->fresh()->credit_balance,
        ], 'Payment recorded');
    }

    public function update(UpdateCustomerRequest $request, string $id): JsonResponse
    {
        $customer = Customer::query()->findOrFail($id);
        $customer->update($request->validated());

        return ApiResponse::ok($customer, 'Customer updated');
    }

    public function destroy(string $id): JsonResponse
    {
        Customer::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Customer deleted');
    }
}
