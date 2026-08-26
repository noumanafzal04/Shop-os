<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\SubscriptionPayment;
use App\Support\ApiResponse;
use App\Support\Modules;
use App\Support\PlanLimits;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * The shop's own view of its subscription: current plan, module bundle,
 * live usage vs effective limits (plan baseline or per-tenant extension),
 * and its payment history. Read-only — plans are assigned and extended by
 * the platform admin; this page is how the owner sees where they stand.
 */
class SubscriptionController extends Controller
{
    public function __construct(private readonly TenantContext $context) {}

    public function show(): JsonResponse
    {
        $tenant = $this->context->get();
        $tenant->loadMissing('plan');
        $plan = $tenant->plan;

        return ApiResponse::ok([
            'plan' => $plan === null ? null : [
                'id' => $plan->id,
                'name' => $plan->name,
                'code' => $plan->code,
                'description' => $plan->description,
                'price' => $plan->price,
                'billing_period_months' => $plan->billing_period_months,
                'grace_period_days' => $plan->grace_period_days,
                'is_custom' => $plan->is_custom,
            ],
            'state' => $tenant->subscriptionState(),
            'subscription_ends_at' => $tenant->subscription_ends_at?->toIso8601String(),
            'grace_ends_at' => $tenant->graceEndsAt()?->toIso8601String(),
            'modules' => $tenant->features ?? [],
            // THE SAME LIST, WITH ITS OWN WORDS.
            //
            // The screen was translating three keys — pos, expenses,
            // marketplace — from a map that holds eleven, so a restaurant saw
            // nothing about its dine-in, a chemist nothing about its
            // inventory and a station nothing about its forecourt. A shop was
            // reading "what your shop runs" and being shown a third of it.
            //
            // The labels already exist in Modules and are already handed to
            // the admin console. A second copy in the panel is what produced
            // the gap; there is one source now, and it cannot fall behind the
            // registry because it IS the registry.
            'modules_on' => collect(Modules::catalog())
                ->filter(fn (array $module): bool => ! empty(($tenant->features ?? [])[$module['key']]))
                ->map(fn (array $module): array => [
                    'key' => $module['key'],
                    'label' => $module['label'],
                    'description' => $module['description'],
                ])
                ->values(),
            // Usage vs the EFFECTIVE ceiling — the shop's own assigned limit
            // wins, then its plan, then the platform default. Same engine the
            // admin panel meters with. The plan above is only what it pays;
            // what it can DO is `modules`, and no renewal touches that.
            'limits_usage' => PlanLimits::snapshot($tenant),
            'payments' => SubscriptionPayment::query()
                ->where('tenant_id', $tenant->id)
                ->orderByDesc('paid_at')
                ->limit(24)
                ->get()
                ->map(fn (SubscriptionPayment $p) => [
                    'id' => $p->id,
                    'plan_name' => $p->plan_name,
                    'amount' => $p->amount,
                    'method' => $p->method,
                    'reference' => $p->reference,
                    'period_start' => $p->period_start->toDateString(),
                    'period_end' => $p->period_end->toDateString(),
                    'paid_at' => $p->paid_at->toIso8601String(),
                ]),
        ]);
    }
}
