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
    public function forTenant(Tenant $tenant): array
    {
        $todayStart = now()->startOfDay();

        $todaySales = Sale::query()
            ->where('tenant_id', $tenant->id)
            ->where('status', SaleStatus::Completed)
            ->where('sold_at', '>=', $todayStart);

        $salesCount = (clone $todaySales)->count();
        $revenue = (float) (clone $todaySales)->sum('total');

        // Profit = revenue - cost of goods sold (from line snapshots).
        // Expense deduction joins in at Step 10.
        $cogs = (float) SaleItem::query()
            ->where('sale_items.tenant_id', $tenant->id)
            ->whereHas('sale', function ($q) use ($todayStart): void {
                $q->where('status', SaleStatus::Completed)
                    ->where('sold_at', '>=', $todayStart);
            })
            ->selectRaw('COALESCE(SUM(unit_cost * quantity), 0) as cogs')
            ->value('cogs');

        $expensesToday = (float) Expense::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->whereDate('expense_date', $todayStart->toDateString())
            ->sum('amount');

        return [
            'setup_completed' => $tenant->setup_completed,
            'online_shop_enabled' => $tenant->online_shop_enabled,
            'subscription_expired' => $tenant->subscriptionExpired(),
            'subscription_state' => $tenant->subscriptionState(),
            'grace_ends_at' => $tenant->graceEndsAt()?->toIso8601String(),
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
            'low_stock_count' => Product::query()
                ->where('tenant_id', $tenant->id)
                ->where('track_inventory', true)
                ->whereNotNull('low_stock_threshold')
                ->whereColumn('stock_quantity', '<=', 'low_stock_threshold')
                ->count(),
            'products_count' => Product::query()
                ->where('tenant_id', $tenant->id)
                ->where('is_active', true)
                ->count(),
        ];
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
