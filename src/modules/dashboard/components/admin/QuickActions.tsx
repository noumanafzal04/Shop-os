import { Link } from "react-router";

/** Every target is a route registered in App.tsx under /admin. */
const ACTIONS = [
  { label: "New Tenant", to: "/admin/tenants/new" },
  { label: "All Tenants", to: "/admin/tenants" },
  { label: "Payments", to: "/admin/payments" },
  { label: "Plans", to: "/admin/plans" },
  { label: "Platform Config", to: "/admin/config" },
  { label: "Admin Staff", to: "/admin/staff" },
  { label: "Audit Logs", to: "/admin/audit-logs" },
  { label: "Banners", to: "/admin/banners" },
  { label: "Announcements", to: "/admin/announcements" },
] as const;

export function QuickActions() {
  return (
    <div className="flex flex-wrap gap-3">
      {ACTIONS.map((a) => (
        <Link
          key={a.to}
          to={a.to}
          className="inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-theme-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition hover:bg-gray-50 hover:text-gray-800 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700 dark:hover:bg-white/[0.03] dark:hover:text-gray-300"
        >
          {a.label}
        </Link>
      ))}
    </div>
  );
}
