import type { BooksWaiting } from "./components/shop/booksWaiting";
import type { PeriodTold } from "./period";

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

/**
 * One point of the chart. A day, until the period is too long to draw a point
 * a day — then a week, then a month; `period.series.bucket` says which.
 */
export interface SeriesDay {
  /** What the axis calls the point: "Mon", "9 Oct", "Oct". */
  day: string;
  /** The first date the point covers: "2026-08-05". */
  date: string;
  /** The last date it covers — the same as `date` for a point a day wide. */
  to?: string;
  revenue: number;
  /** Money in that wasn't a sale. Zero for a shop that records none. */
  other_income: number;
  /** Handed back over the counter that day. Already subtracted from `profit`. */
  refunds: number;
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

/** The figures a shop is shown for a day or a run of days. */
export interface ShopFigures {
  sales_count: number;
  revenue: number;
  /** Non-sale money in — kept apart from `revenue` so "what we sold" stays honest. */
  other_income: number;
  /**
   * Handed back in the period. `revenue` stays GROSS — a refund is dated by
   * the day it went out, so netting it would rewrite a day that may already
   * be closed and banked. `profit` has it subtracted.
   */
  refunds: number;
  expenses: number;
  profit: number;
  /** Buyers served, not tickets rung — one customer once, however often they came. */
  customers_count: number;
  /** Signed % against what the period is compared with; null when that was zero. */
  deltas: {
    revenue: number | null;
    expenses: number | null;
    profit: number | null;
  };
}

export interface TenantDashboard {
  setup_completed: boolean;
  online_shop_enabled: boolean;
  subscription_expired: boolean;
  subscription_state: "active" | "grace" | "read_only";
  grace_ends_at: string | null;
  /**
   * TODAY, whatever period was asked about. The line at the head of the
   * screen is about now.
   */
  today: ShopFigures;
  /**
   * THE PERIOD ASKED ABOUT — the same figures, for its dates, and which dates
   * those are. Identical to `today` when nobody asked. Everything on the
   * screen that is a flow reads this; see modules/dashboard/period.ts.
   */
  period: PeriodTold & ShopFigures;
  pending_orders: number;
  pending_reservations: number;
  low_stock_count: number;
  // Batches expiring within 30 days (incl. already-expired) — pharmacy/perishables.
  expiring_soon_count: number;
  products_count: number;
  // The branch these figures reflect (null = all branches / HQ view).
  branch_scope: string | null;
  /**
   * The period a point at a time, oldest first, zero-filled so the chart never
   * has a hole. A single day is drawn as the last of the seven that led to it.
   */
  sales_series: SeriesDay[];
  /** The period's spend per category. Empty when the shop keeps no books. */
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
  /**
   * What the books are waiting on NOW — bills and expected payments that have
   * fallen due, categories past their ceiling this month. Null for a shop that
   * keeps no books; absent from an older server.
   */
  books?: BooksWaiting | null;
  /** The period's leaders. Each entry is null when there is nothing to crown. */
  highlights: {
    top_product: { name: string; units: number; revenue: number } | null;
    top_category: { name: string; revenue: number } | null;
    top_customer: { id: string; name: string; sales_count: number; revenue: number } | null;
    top_staff: { id: string; name: string; sales_count: number; revenue: number } | null;
  };
  /**
   * The restaurant floor as it stands this minute — NOT a "today" figure.
   * Null for a shop with no dine-in module, so the panel is absent rather than
   * a grid of zeroes. Not branch-scoped: the dine-in tables carry no branch.
   */
  floor: {
    tables: number;
    occupied: number;
    open_tabs: number;
    /** Fired, still cooking. */
    kot_waiting: number;
    /** Under the lamp, waiting to be run — the ones that go cold. */
    kot_ready: number;
  } | null;
  /**
   * Today's prescription trade, kept apart from over-the-counter sales. Null
   * for any shop that is not a pharmacy (legacy `clinic` resolves in).
   */
  dispensing: {
    rx_sales: number;
    rx_revenue: number;
    /** Distinct prescribers today. */
    prescribers: number;
  } | null;
  /**
   * A workshop's morning question: what is in the bay, and what has been
   * finished and not yet charged for. Null for every trade that is not
   * automotive.
   *
   * `ready.value` is the one that matters. A job marked ready is finished
   * work; if the document is still open, nobody has invoiced it — and a car
   * collected without the card being converted is work the shop will never be
   * paid for.
   */
  bay: {
    received: BayStage;
    in_progress: BayStage;
    ready: BayStage;
    /** Past the time somebody was told, at any stage. */
    overdue: number;
  } | null;
  activity: ActivityRow[];
  // Per-branch sales in the period (HQ comparison). Empty for single-branch shops.
  branches: Array<{ branch_id: string; branch: string; sales_count: number; revenue: number }>;
}

export interface BayStage {
  cars: number;
  /** What the open job cards at this stage come to. */
  value: number;
}

export interface AdminDashboard {
  /** The period `in_period` is cut to. The seven days ending today when nobody asked. */
  period: PeriodTold;
  /**
   * WHAT HAPPENED IN THE PERIOD — flows only, each beside the same count for
   * the period it is compared with. What the platform IS (shops,
   * subscriptions, riders) is `kpis`, and is always now.
   */
  in_period: {
    /** Subscription money collected. Absent without `billing.view`. */
    revenue?: Kpi;
    /** How many payments that was. Absent without `billing.view`. */
    payments?: number;
    /** Real shops that joined. A demo handed out from the landing page did not. */
    new_tenants: Kpi;
    /** Shops that began as a demo and were turned into a business in the period. */
    kept_from_demo: number;
    /** Marketplace orders placed. */
    online_orders: Kpi;
    /** What those orders came to — the shops' money, not the platform's. */
    orders_value: number;
    /** People who signed up to buy. */
    new_customers: Kpi;
  };
  tenants: {
    /**
     * Shops a stranger was handed from the landing page, which expire the next
     * day. Kept OUT of every figure below and reported on its own: counting a
     * demo as a business overstates the platform, and dropping it silently
     * would hide how many people are trying the product.
     */
    demos: number;
    total: number;
    active: number;
    suspended: number;
    online_shops: number;
    new_this_month: number;
  };
  kpis: {
    total_tenants: Kpi;
    active_subscriptions: Kpi;
    /**
     * Withheld from platform staff without `billing.view` — the server omits
     * the key rather than sending a zero, because a zero is an answer and the
     * wrong one. Optional here so the panel is forced to handle its absence.
     */
    revenue_this_month?: Kpi;
    online_orders_today: Kpi;
    active_riders: Kpi;
    new_tenants_this_month: Kpi;
  };
  /** 12 months, oldest first, zero-filled. Absent without `billing.view`. */
  revenue_series?: Array<{ month: string; ym: string; total: number }>;
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
    /** Absent without `billing.view` — the plan's PRICE is not the same thing. */
    revenue?: number;
  }>;
  /**
   * What the platform's active shops actually run. Modules are assigned per
   * tenant, not bundled into a plan, so the plan ladder says nothing about
   * usage — this is the only view of it.
   */
  modules: Array<{ key: string; label: string; count: number; share: number }>;
  /** Absent without `billing.view`. */
  recent_payments?: Array<{
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
