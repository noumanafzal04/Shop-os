<?php

namespace App\Services;

use App\Enums\ReservationStatus;
use App\Enums\SaleStatus;
use App\Enums\TenantStatus;
use App\Models\Expense;
use App\Models\Product;
use App\Models\Reservation;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\Tenant;

/**
 * Dashboard aggregations.
 *
 * The tenant dashboard's sales/expenses/inventory numbers activate as those
 * modules land (Steps 7-10) — until then the API contract is stable and
 * frontends render honest empty states (the "empty dashboard" edge case).
 * All "today" windows use the tenant's timezone setting when reports land.
 */
class DashboardService
{
    /**
     * @param  string|null  $branchId  Scope the sales/stock figures to one
     *                                  branch, or null for the whole tenant
     *                                  (an owner's All-Branches HQ view).
     */
    public function forTenant(Tenant $tenant, ?string $branchId = null): array
    {
        $todayStart = now()->startOfDay();

        $todaySales = Sale::query()
            ->where('tenant_id', $tenant->id)
            ->where('status', SaleStatus::Completed)
            ->where('sold_at', '>=', $todayStart)
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b));

        $salesCount = (clone $todaySales)->count();
        $revenue = (float) (clone $todaySales)->sum('total');

        // Profit = revenue - cost of goods sold (from line snapshots).
        // Expense deduction joins in at Step 10.
        $cogs = (float) SaleItem::query()
            ->where('sale_items.tenant_id', $tenant->id)
            ->whereHas('sale', function ($q) use ($todayStart, $branchId): void {
                $q->where('status', SaleStatus::Completed)
                    ->where('sold_at', '>=', $todayStart)
                    ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b));
            })
            ->selectRaw('COALESCE(SUM(unit_cost * quantity), 0) as cogs')
            ->value('cogs');

        // Expenses are branch-scoped: a focused branch deducts only its own
        // costs; the all-branches view (branchId null) sums the whole tenant.
        $expensesToday = (float) Expense::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
            ->whereDate('expense_date', $todayStart->toDateString())
            ->sum('amount');

        return [
            'setup_completed' => $tenant->setup_completed,
            'online_shop_enabled' => $tenant->online_shop_enabled,
            'subscription_expired' => $tenant->subscriptionExpired(),
            'subscription_state' => $tenant->subscriptionState(),
            'grace_ends_at' => $tenant->graceEndsAt()?->toIso8601String(),
            // Which branch these numbers reflect (null = all branches / HQ).
            'branch_scope' => $branchId,
            'today' => [
                'sales_count' => $salesCount,
                'revenue' => round($revenue, 2),
                'expenses' => round($expensesToday, 2),
                // Net profit: revenue − cost of goods − expenses.
                'profit' => round($revenue - $cogs - $expensesToday, 2),
            ],
            'pending_orders' => \App\Models\Order::withoutTenancy()
                ->where('tenant_id', $tenant->id)
                ->whereNotIn('status', ['completed', 'cancelled'])
                ->count(),
            'pending_reservations' => Reservation::withoutTenancy()
                ->where('tenant_id', $tenant->id)
                ->where('status', ReservationStatus::Pending)
                ->where('expires_at', '>', now())
                ->count(),
            'low_stock_count' => $this->lowStockCount($tenant, $branchId),
            // Batches (medicine/perishable lots) expiring within 30 days —
            // includes already-expired stock still on hand. Branch-scoped.
            'expiring_soon_count' => \App\Models\ProductBatch::query()
                ->where('tenant_id', $tenant->id)
                ->expiringWithin(30)
                ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
                ->count(),
            'products_count' => Product::query()
                ->where('tenant_id', $tenant->id)
                ->where('is_active', true)
                ->count(),
            // HQ comparison: today's sales per branch. Only for multi-branch
            // tenants (a single-shop owner gets an empty array, no HQ panel).
            'branches' => $this->branchBreakdown($tenant, $todayStart),
        ];
    }

    /**
     * Low-stock item count. All-branches uses the rollup stock_quantity; a
     * single branch compares that branch's on-hand (branch_stock) to the
     * product's threshold.
     */
    private function lowStockCount(Tenant $tenant, ?string $branchId): int
    {
        if ($branchId === null) {
            return Product::query()
                ->where('tenant_id', $tenant->id)
                ->where('track_inventory', true)
                ->whereNotNull('low_stock_threshold')
                ->whereColumn('stock_quantity', '<=', 'low_stock_threshold')
                ->count();
        }

        return Product::query()
            ->where('products.tenant_id', $tenant->id)
            ->where('track_inventory', true)
            ->whereNotNull('low_stock_threshold')
            ->leftJoin('branch_stock', function ($join) use ($branchId): void {
                $join->on('branch_stock.product_id', '=', 'products.id')
                    ->whereNull('branch_stock.variant_id')
                    ->where('branch_stock.branch_id', '=', $branchId);
            })
            ->whereRaw('COALESCE(branch_stock.quantity, 0) <= products.low_stock_threshold')
            ->count();
    }

    /**
     * Today's completed-sales count + revenue for every active branch — the
     * per-branch comparison behind the HQ dashboard. Empty for single-branch
     * tenants.
     *
     * @return array<int, array{branch_id: string, branch: string, sales_count: int, revenue: float}>
     */
    private function branchBreakdown(Tenant $tenant, \Illuminate\Support\Carbon $todayStart): array
    {
        $branches = \App\Models\Branch::query()
            ->where('tenant_id', $tenant->id)
            ->where('is_active', true)
            ->orderByDesc('is_default')
            ->orderBy('name')
            ->get(['id', 'name']);

        if ($branches->count() < 2) {
            return [];
        }

        return $branches->map(function ($b) use ($tenant, $todayStart): array {
            $q = Sale::query()
                ->where('tenant_id', $tenant->id)
                ->where('status', SaleStatus::Completed)
                ->where('sold_at', '>=', $todayStart)
                ->where('branch_id', $b->id);

            return [
                'branch_id' => $b->id,
                'branch' => $b->name,
                'sales_count' => (clone $q)->count(),
                'revenue' => round((float) (clone $q)->sum('total'), 2),
            ];
        })->all();
    }

    public function forPlatform(): array
    {
        $tenants = Tenant::query();

        return [
            'tenants' => [
                'total' => (clone $tenants)->count(),
                'active' => (clone $tenants)->where('status', TenantStatus::Active)->count(),
                'suspended' => (clone $tenants)->where('status', TenantStatus::Suspended)->count(),
                'online_shops' => (clone $tenants)->where('online_shop_enabled', true)->count(),
                'new_this_month' => (clone $tenants)
                    ->where('created_at', '>=', now()->startOfMonth())
                    ->count(),
            ],
            'recent_tenants' => Tenant::query()
                ->with('plan:id,name,code')
                ->latest()
                ->limit(5)
                ->get(['id', 'business_name', 'status', 'online_shop_enabled', 'plan_id', 'created_at']),
        ];
    }
}
