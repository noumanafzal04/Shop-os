<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\CommissionCharge;
use App\Models\CommissionInvoice;
use App\Models\Tenant;
use App\Services\CommissionService;
use App\Support\ApiResponse;
use App\Support\PlatformSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
     * Every shop, and what it owes.
     *
     * Ordered by what is outstanding, largest first: this is a screen somebody
     * opens to chase money, and a list sorted by name buries the four that
     * matter under forty that do not.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'owing' => ['sometimes', 'boolean'],
        ]);

        $shops = Tenant::query()
            ->where('is_demo', false)
            ->when($request->filled('search'), fn ($q) => $q->where('business_name', 'like', '%'.$request->string('search')->value().'%'))
            ->get(['id', 'business_name', 'slug', 'commission_rate'])
            ->map(function (Tenant $shop) {
                $outstanding = app(CommissionService::class)->outstanding($shop);

                return [
                    'id' => $shop->id,
                    'business_name' => $shop->business_name,
                    'slug' => $shop->slug,
                    // Null means "follows the platform default", and the screen
                    // says so rather than printing the resolved number as
                    // though the shop had chosen it.
                    'commission_rate' => $shop->commission_rate !== null ? (float) $shop->commission_rate : null,
                    'effective_rate' => app(CommissionService::class)->rateFor($shop),
                    'outstanding_orders' => $outstanding['orders'],
                    'outstanding_amount' => $outstanding['amount'],
                    'unpaid_invoices' => CommissionInvoice::withoutTenancy()
                        ->where('tenant_id', $shop->id)->where('status', 'unpaid')->count(),
                ];
            })
            ->when($request->boolean('owing'), fn ($rows) => $rows->filter(fn ($r) => $r['outstanding_amount'] > 0))
            ->sortByDesc('outstanding_amount')
            ->values();

        return ApiResponse::ok([
            'shops' => $shops,
            'total_outstanding' => round((float) $shops->sum('outstanding_amount'), 2),
        ]);
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
