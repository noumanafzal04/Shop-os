<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\CommissionCharge;
use App\Models\CommissionInvoice;
use App\Services\CommissionService;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * WHAT THIS SHOP OWES THE PLATFORM, from the shop's own side.
 *
 * It exists because a bill nobody can check is a bill nobody trusts. A shop
 * that sees only a total has to take the platform's word for it; a shop that
 * can see the orders behind the number can argue about a specific one, which
 * is the difference between an invoice and a demand.
 *
 * Read-only, deliberately. A shop cannot waive its own charges.
 */
class ShopCommissionController extends Controller
{
    public function show(TenantContext $context, CommissionService $commission): JsonResponse
    {
        $shop = $context->get();
        abort_if($shop === null, 400);

        $outstanding = $commission->outstanding($shop);

        $charges = CommissionCharge::query()
            ->outstanding()
            ->with('order:id,order_number,total,placed_at')
            ->orderByDesc('created_at')
            ->limit(100)
            ->get();

        $invoices = CommissionInvoice::query()
            ->orderByDesc('created_at')
            ->limit(24)
            ->get();

        return ApiResponse::ok([
            'rate' => $commission->rateFor($shop),
            // Whether this shop negotiated its own, or follows the platform's.
            // A shop asking "why am I paying this" deserves the answer.
            'rate_is_yours' => $shop->commission_rate !== null,
            'outstanding' => $outstanding,
            'charges' => $charges->map(fn (CommissionCharge $c) => [
                'order_number' => $c->order?->order_number,
                'order_total' => $c->order?->total,
                'rate_percent' => (float) $c->rate_percent,
                'base_amount' => (float) $c->base_amount,
                'amount' => (float) $c->amount,
                'charged_at' => $c->created_at?->toIso8601String(),
            ]),
            'invoices' => $invoices->map(fn (CommissionInvoice $i) => [
                'number' => $i->number,
                'period_start' => $i->period_start?->toDateString(),
                'period_end' => $i->period_end?->toDateString(),
                'orders_count' => $i->orders_count,
                'amount' => (float) $i->amount,
                'status' => $i->status,
                'paid_at' => $i->paid_at?->toIso8601String(),
            ]),
        ]);
    }
}
