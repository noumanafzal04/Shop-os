<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\CommissionCharge;
use App\Models\CommissionInvoice;
use App\Models\Tenant;
use App\Services\CommissionService;
use App\Support\ApiResponse;
use App\Support\PlatformSettings;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * WHAT THE PLATFORM IS OWED.
 *
 * ── Why this is not the Billing screen ───────────────────────────────
 *
 * `/admin/payments` is the PLAN ledger: what each shop pays monthly for the
 * software. This is commission: a share of what the marketplace sold for them.
 * Two debts, two reasons, two screens — a shop that cannot tell which number is
 * which cannot check either.
 */
class CommissionController extends Controller
{
    /** The platform's own settings, and what they currently mean. */
    public function settings(): JsonResponse
    {
        return ApiResponse::ok([
            'settings' => PlatformSettings::all(),
            // Sent so the screen can say "0–50%" without repeating the bound.
            // A rate typed here bills every shop on the platform.
            'max_rate' => 50,
        ]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $data = $request->validate(PlatformSettings::rules());

        PlatformSettings::put($data, $request->user()->id);

        return ApiResponse::ok(PlatformSettings::all(), 'Settings saved');
    }

    /**
     * Every shop, and what it owes — a page at a time.
     *
     * ── What a shop owes is two piles, and they are kept apart ────────
     *
     *   NOT YET BILLED   charges on no invoice and not written off. The
     *                    platform has earned it and has not asked for it.
     *   BILLED, UNPAID   invoices raised and not yet marked paid. The
     *                    platform has asked, and is waiting.
     *
     * The list used to show only the first as money and the second as a
     * count of invoices — so a shop holding Rs 40,000 of unpaid invoices and
     * nothing new read as owing nothing, and sorted to the bottom of a screen
     * somebody opens to chase money.
     *
     * Ordered by the two together, largest first, unless asked otherwise.
     *
     * ── Counted in the database, a page at a time ─────────────────────
     *
     * This loaded EVERY shop and asked two questions of each — two queries a
     * shop, on a list with no pages. Forty shops was eighty-one queries; four
     * hundred would have been eight hundred and one. It is three now, whatever
     * the platform's size: the page, the figures above it, and what was
     * collected this month.
     */
    public function index(Request $request, CommissionService $commission): JsonResponse
    {
        $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'standing' => ['nullable', Rule::in(['unbilled', 'invoiced', 'clear'])],
            'rate' => ['nullable', Rule::in(['own', 'platform'])],
            'sort' => ['nullable', Rule::in(['owed', 'unbilled', 'invoiced', 'name'])],
        ]);

        // A count beside a filter is taken with every OTHER filter applied and
        // not its own — or pressing "Not yet billed" would change the number
        // on the button that was pressed.
        $shops = fn (?string $except = null) => $this->shops($request, $except);

        $unbilled = 'coalesce(c.outstanding_amount, 0)';
        $unpaid = 'coalesce(i.unpaid_amount, 0)';

        $page = $shops()->select([
            'tenants.id', 'tenants.business_name', 'tenants.slug', 'tenants.business_type', 'tenants.commission_rate',
            DB::raw('coalesce(c.outstanding_orders, 0) as outstanding_orders'),
            DB::raw("{$unbilled} as outstanding_amount"),
            DB::raw('coalesce(i.unpaid_invoices, 0) as unpaid_invoices'),
            DB::raw("{$unpaid} as unpaid_amount"),
        ]);

        match ($request->query('sort', 'owed')) {
            'name' => $page->orderBy('tenants.business_name'),
            'unbilled' => $page->orderByRaw("{$unbilled} desc")->orderBy('tenants.business_name'),
            'invoiced' => $page->orderByRaw("{$unpaid} desc")->orderBy('tenants.business_name'),
            // This is a screen somebody opens to chase money: a list sorted by
            // name buries the four that matter under forty that do not.
            default => $page->orderByRaw("({$unbilled} + {$unpaid}) desc")->orderBy('tenants.business_name'),
        };

        $rows = $page->stably()->paginate(25);

        $rows->through(fn (Tenant $shop): array => [
            'id' => $shop->id,
            'business_name' => $shop->business_name,
            'slug' => $shop->slug,
            'business_type' => $shop->business_type,
            // Null means "follows the platform default", and the screen
            // says so rather than printing the resolved number as
            // though the shop had chosen it.
            'commission_rate' => $shop->commission_rate !== null ? (float) $shop->commission_rate : null,
            'effective_rate' => $commission->rateFor($shop),
            'outstanding_orders' => (int) $shop->getAttribute('outstanding_orders'),
            'outstanding_amount' => round((float) $shop->getAttribute('outstanding_amount'), 2),
            'unpaid_invoices' => (int) $shop->getAttribute('unpaid_invoices'),
            'unpaid_amount' => round((float) $shop->getAttribute('unpaid_amount'), 2),
            // Everything this shop owes the platform, asked for or not.
            'owed' => round((float) $shop->getAttribute('outstanding_amount') + (float) $shop->getAttribute('unpaid_amount'), 2),
        ]);

        $standing = $shops('standing')->selectRaw(implode(', ', [
            'count(*) as shops',
            'sum(case when c.tenant_id is not null then 1 else 0 end) as unbilled_shops',
            'coalesce(sum(c.outstanding_orders), 0) as unbilled_orders',
            'coalesce(sum(c.outstanding_amount), 0) as unbilled_amount',
            'sum(case when i.tenant_id is not null then 1 else 0 end) as invoiced_shops',
            'coalesce(sum(i.unpaid_invoices), 0) as unpaid_invoices',
            'coalesce(sum(i.unpaid_amount), 0) as unpaid_amount',
            'sum(case when c.tenant_id is null and i.tenant_id is null then 1 else 0 end) as clear_shops',
        ]))->toBase()->first();

        $rates = $shops('rate')->selectRaw(
            'sum(case when tenants.commission_rate is not null then 1 else 0 end) as own,'
            .' sum(case when tenants.commission_rate is null then 1 else 0 end) as platform'
        )->toBase()->first();

        // What has actually come in, this calendar month — the one figure on
        // this screen that is good news, and it had no place on it.
        //
        // By `paid_at` alone: only marking an invoice paid ever writes it, and
        // a paid invoice cannot be withdrawn — so it is the status, with a date.
        $collected = CommissionInvoice::withoutTenancy()
            ->where('paid_at', '>=', now()->startOfMonth())
            ->selectRaw('count(*) as invoices, coalesce(sum(amount), 0) as amount')
            ->toBase()
            ->first();

        return ApiResponse::paginated($rows, 'OK', [
            'summary' => [
                'shops' => (int) ($standing->shops ?? 0),
                'unbilled' => [
                    'shops' => (int) ($standing->unbilled_shops ?? 0),
                    'orders' => (int) ($standing->unbilled_orders ?? 0),
                    'amount' => round((float) ($standing->unbilled_amount ?? 0), 2),
                ],
                'invoiced' => [
                    'shops' => (int) ($standing->invoiced_shops ?? 0),
                    'invoices' => (int) ($standing->unpaid_invoices ?? 0),
                    'amount' => round((float) ($standing->unpaid_amount ?? 0), 2),
                ],
                'clear' => ['shops' => (int) ($standing->clear_shops ?? 0)],
                'rates' => ['own' => (int) ($rates->own ?? 0), 'platform' => (int) ($rates->platform ?? 0)],
                'collected_this_month' => [
                    'invoices' => (int) ($collected->invoices ?? 0),
                    'amount' => round((float) ($collected->amount ?? 0), 2),
                ],
            ],
        ]);
    }

    /**
     * Real shops, each beside its two piles, narrowed by everything asked
     * for except `$except`.
     *
     * The piles are joined as grouped totals rather than counted per row: one
     * pass over each table, and real columns to sort and filter on.
     */
    private function shops(Request $request, ?string $except): Builder
    {
        $charges = DB::table('commission_charges')
            ->whereNull('invoice_id')
            ->whereNull('waived_at')
            ->groupBy('tenant_id')
            ->selectRaw('tenant_id, count(*) as outstanding_orders, sum(amount) as outstanding_amount');

        $invoices = DB::table('commission_invoices')
            ->where('status', 'unpaid')
            ->groupBy('tenant_id')
            ->selectRaw('tenant_id, count(*) as unpaid_invoices, sum(amount) as unpaid_amount');

        $standing = $except === 'standing' ? null : $request->query('standing');
        $rate = $except === 'rate' ? null : $request->query('rate');

        return Tenant::query()
            // A demo is not a business and owes nobody anything.
            ->real()
            ->leftJoinSub($charges, 'c', 'c.tenant_id', '=', 'tenants.id')
            ->leftJoinSub($invoices, 'i', 'i.tenant_id', '=', 'tenants.id')
            ->when($request->filled('search'), fn (Builder $q) => $q->where(
                'tenants.business_name', 'like', '%'.$request->string('search')->value().'%',
            ))
            ->when($standing === 'unbilled', fn (Builder $q) => $q->whereNotNull('c.tenant_id'))
            ->when($standing === 'invoiced', fn (Builder $q) => $q->whereNotNull('i.tenant_id'))
            ->when($standing === 'clear', fn (Builder $q) => $q->whereNull('c.tenant_id')->whereNull('i.tenant_id'))
            ->when($rate === 'own', fn (Builder $q) => $q->whereNotNull('tenants.commission_rate'))
            ->when($rate === 'platform', fn (Builder $q) => $q->whereNull('tenants.commission_rate'));
    }

    /** One shop: its rate, what it owes, and every bill it has been sent. */
    public function show(string $tenantId, CommissionService $commission): JsonResponse
    {
        $shop = Tenant::query()->findOrFail($tenantId);

        $charges = CommissionCharge::withoutTenancy()
            ->where('tenant_id', $shop->id)
            ->outstanding()
            ->with('order:id,order_number,total,placed_at')
            ->orderByDesc('created_at')
            ->limit(200)
            ->get();

        $invoices = CommissionInvoice::withoutTenancy()
            ->where('tenant_id', $shop->id)
            ->orderByDesc('created_at')
            ->limit(50)
            ->get();

        return ApiResponse::ok([
            'shop' => [
                'id' => $shop->id,
                'business_name' => $shop->business_name,
                'commission_rate' => $shop->commission_rate !== null ? (float) $shop->commission_rate : null,
                'effective_rate' => $commission->rateFor($shop),
            ],
            'outstanding' => $commission->outstanding($shop),
            'charges' => $charges->map(fn (CommissionCharge $c) => [
                'id' => $c->id,
                'order_number' => $c->order?->order_number,
                'order_total' => $c->order?->total,
                'rate_percent' => (float) $c->rate_percent,
                'base_amount' => (float) $c->base_amount,
                'amount' => (float) $c->amount,
                'charged_at' => $c->created_at?->toIso8601String(),
            ]),
            'invoices' => $invoices->map(fn (CommissionInvoice $i) => [
                'id' => $i->id,
                'number' => $i->number,
                'period_start' => $i->period_start?->toDateString(),
                'period_end' => $i->period_end?->toDateString(),
                'orders_count' => $i->orders_count,
                'amount' => (float) $i->amount,
                'status' => $i->status,
                'paid_at' => $i->paid_at?->toIso8601String(),
                'note' => $i->note,
            ]),
        ]);
    }

    /**
     * A shop's own rate.
     *
     * Null clears it, which is not the same as zero: null follows the platform
     * default for ever after, and zero is a promise that this shop pays
     * nothing whatever the default becomes.
     */
    public function setRate(Request $request, string $tenantId): JsonResponse
    {
        $data = $request->validate([
            'commission_rate' => ['present', 'nullable', 'numeric', 'min:0', 'max:50'],
        ]);

        $shop = Tenant::query()->findOrFail($tenantId);
        $shop->forceFill(['commission_rate' => $data['commission_rate']])->save();

        return ApiResponse::ok([
            'commission_rate' => $shop->commission_rate !== null ? (float) $shop->commission_rate : null,
            'effective_rate' => app(CommissionService::class)->rateFor($shop),
        ], $data['commission_rate'] === null ? 'Following the platform rate' : 'Rate saved');
    }

    public function raiseInvoice(Request $request, string $tenantId, CommissionService $commission): JsonResponse
    {
        $data = $request->validate([
            'from' => ['required', 'date'],
            'to' => ['required', 'date', 'after_or_equal:from'],
        ]);

        $shop = Tenant::query()->findOrFail($tenantId);
        $invoice = $commission->raiseInvoice($shop, $data['from'], $data['to'], $request->user());

        return ApiResponse::created($invoice, "Invoice {$invoice->number} raised");
    }

    public function markPaid(Request $request, string $id, CommissionService $commission): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);

        $invoice = CommissionInvoice::withoutTenancy()->findOrFail($id);

        return ApiResponse::ok(
            $commission->markPaid($invoice, $request->user(), $data['note'] ?? null),
            'Marked paid',
        );
    }

    public function voidInvoice(Request $request, string $id, CommissionService $commission): JsonResponse
    {
        // A reason is required. An invoice withdrawn without one is a number a
        // shop saw and can never be told the fate of.
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);

        $invoice = CommissionInvoice::withoutTenancy()->findOrFail($id);

        return ApiResponse::ok(
            $commission->voidInvoice($invoice, $request->user(), $data['reason']),
            'Invoice withdrawn — its charges are outstanding again',
        );
    }

    public function waive(Request $request, string $id, CommissionService $commission): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);

        $charge = CommissionCharge::withoutTenancy()->findOrFail($id);

        return ApiResponse::ok(
            $commission->waive($charge, $request->user(), $data['reason']),
            'Charge written off',
        );
    }
}
