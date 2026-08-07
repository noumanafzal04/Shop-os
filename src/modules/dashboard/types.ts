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
