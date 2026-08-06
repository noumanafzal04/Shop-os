/**
 * Dashboard payload contracts — mirrors App\Services\DashboardService.
 *
 * Money and counts arrive as numbers, but JSON cannot carry the difference
 * between 1500.0 and 1500: a whole-rupee total decodes as an int. Never compare
 * these by identity against a float — format them.
 */

/**
 * A KPI tile: the figure now, the same figure last period, and the signed
 * percentage between them. `delta_pct` is NULL when the previous period was
 * zero — there is no honest percentage against nothing, so the UI hides the
 * pill rather than printing "+100%" on a shop's first day.
 */
export interface Kpi {
  value: number;
  previous: number;
  delta_pct: number | null;
}

export interface SeriesDay {
  day: string; // "Mon"
  date: string; // "2026-08-05"
  revenue: number;
  /** Money in that wasn't a sale. Zero for a shop that records none. */
  other_income: number;
  expenses: number;
  profit: number;
}

export interface ExpenseSlice {
  category: string;
  total: number;
}

export interface OrderPipeline {
  pending: number;
  preparing: number;
  delivery: number;
  completed: number;
}

export interface RecentSaleRow {
  id: string;
  invoice_number: string;
  customer: string;
  total: number;
  status: string;
  sold_at: string | null;
}

export interface RecentExpenseRow {
  id: string;
  category: string;
  payee: string | null;
  description: string | null;
  date: string | null;
  amount: number;
}

/** One timeline entry. The tenant and platform feeds name their fields slightly differently. */
export interface ActivityRow {
  id: string;
  actor: string;
  at: string | null;
  event?: string;
  action?: string;
  entity?: string;
  subject?: string;
  entity_id?: string | null;
  subject_id?: string | null;
  tenant_id?: string | null;
}

export interface TenantDashboard {
  setup_completed: boolean;
  online_shop_enabled: boolean;
  subscription_expired: boolean;
  subscription_state: "active" | "grace" | "read_only";
  grace_ends_at: string | null;
  today: {
    sales_count: number;
    revenue: number;
    /** Non-sale money in — kept apart from `revenue` so "what we sold" stays honest. */
    other_income: number;
    expenses: number;
    profit: number;
    /** Buyers served, not tickets rung. */
    customers_count: number;
    /** Signed % against the same figure yesterday; null when yesterday was zero. */
    deltas: {
      revenue: number | null;
      expenses: number | null;
      profit: number | null;
    };
  };
  pending_orders: number;
  pending_reservations: number;
  low_stock_count: number;
  // Batches expiring within 30 days (incl. already-expired) — pharmacy/perishables.
  expiring_soon_count: number;
  products_count: number;
  // The branch these figures reflect (null = all branches / HQ view).
  branch_scope: string | null;
  /** Last 7 days, oldest first, zero-filled so the chart never has a hole. */
  sales_series: SeriesDay[];
  /** This month's spend per category. Empty when the shop keeps no books. */
  expense_breakdown: ExpenseSlice[];
  inventory: {
    low_stock: number;
    out_of_stock: number;
    expiring_soon: number;
    pending_pos: number;
  };
  order_pipeline: OrderPipeline;
  /**
   * Today at the till. NULL for a shop with no POS module — an online-only
   * business has no drawer, so it is told nothing about one.
   *
   * `unclosed_day` is the one figure nothing else in the product surfaces: a
   * trading day left open never got its roll-up, so the record of that day
   * quietly does not exist.
   */
  till: {
    day_open: boolean;
    day_id: string | null;
    open_shifts: number;
    banked_today: number;
    /** The oldest day still hanging open. Null is the healthy answer. */
    unclosed_day: string | null;
    unclosed_days: number;
  } | null;
  /** Who owes whom. Positive balances only — credit held is not a debt. */
  money_owed: {
    receivable: { total: number; accounts: number };
    payable: { total: number; accounts: number };
  };
  recent_sales: RecentSaleRow[];
  recent_expenses: RecentExpenseRow[];
  /** Each entry is null when there is nothing to crown yet. */
  highlights: {
    top_product: { name: string; units: number; revenue: number } | null;
    top_category: { name: string; revenue: number } | null;
    top_customer: { id: string; name: string; sales_count: number; revenue: number } | null;
    top_staff: { id: string; name: string; sales_count: number; revenue: number } | null;
  };
  activity: ActivityRow[];
  // Per-branch today's sales (HQ comparison). Empty for single-branch shops.
  branches: Array<{ branch_id: string; branch: string; sales_count: number; revenue: number }>;
}

export interface AdminDashboard {
  tenants: {
    total: number;
    active: number;
    suspended: number;
    online_shops: number;
    new_this_month: number;
  };
  kpis: {
    total_tenants: Kpi;
    active_subscriptions: Kpi;
    revenue_this_month: Kpi;
    online_orders_today: Kpi;
    active_riders: Kpi;
    new_tenants_this_month: Kpi;
  };
  /** 12 months, oldest first, zero-filled. */
  revenue_series: Array<{ month: string; ym: string; total: number }>;
  /** 6 months of sign-ups, split by where those tenants stand today. */
  tenant_growth: Array<{ month: string; ym: string; active: number; suspended: number; total: number }>;
  business_types: Array<{ type: string | null; label: string; count: number }>;
  plans: Array<{
    id: string;
    name: string;
    code: string;
    /** PKR per billing period. */
    price: number;
    /** A bespoke enterprise deal, not a rung on the ladder. */
    is_custom: boolean;
    is_active: boolean;
    active_tenants: number;
    revenue: number;
  }>;
  /**
   * What the platform's active shops actually run. Modules are assigned per
   * tenant, not bundled into a plan, so the plan ladder says nothing about
   * usage — this is the only view of it.
   */
  modules: Array<{ key: string; label: string; count: number; share: number }>;
  recent_payments: Array<{
    id: string;
    tenant: string | null;
    tenant_id: string | null;
    plan_name: string | null;
    amount: number;
    currency: string | null;
    method: string | null;
    status: string;
    reference?: string | null;
    paid_at?: string | null;
  }>;
  activity: ActivityRow[];
  recent_tenants: Array<{
    id: string;
    business_name: string;
    status: "active" | "suspended";
    online_shop_enabled: boolean;
    created_at: string;
    business_type?: string | null;
    plan?: { id: string; name: string; code: string } | null;
  }>;
}
