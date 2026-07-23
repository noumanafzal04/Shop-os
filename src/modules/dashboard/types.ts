export interface TenantDashboard {
  setup_completed: boolean;
  online_shop_enabled: boolean;
  subscription_expired: boolean;
  subscription_state: "active" | "grace" | "read_only";
  grace_ends_at: string | null;
  today: {
    sales_count: number;
    revenue: number;
    expenses: number;
    profit: number;
  };
  pending_orders: number;
  pending_reservations: number;
  low_stock_count: number;
  products_count: number;
}

export interface AdminDashboard {
  tenants: {
    total: number;
    active: number;
    suspended: number;
    online_shops: number;
    new_this_month: number;
  };
  recent_tenants: Array<{
    id: string;
    business_name: string;
    status: "active" | "suspended";
    online_shop_enabled: boolean;
    created_at: string;
    plan?: { id: string; name: string; code: string } | null;
  }>;
}
