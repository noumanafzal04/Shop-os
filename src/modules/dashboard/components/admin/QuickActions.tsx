import type { ReactNode } from "react";
import { Link } from "react-router";

import {
  BoxCubeIcon,
  DocsIcon,
  DollarLineIcon,
  GroupIcon,
  ListIcon,
  MailIcon,
  PlugInIcon,
  PlusIcon,
  UserCircleIcon,
} from "../../../../icons";

const GLYPH = "size-4";

/** Every target is a route registered in App.tsx under /admin. */
const ACTIONS: ReadonlyArray<{ label: string; to: string; icon: ReactNode; primary?: boolean }> = [
  { label: "New Tenant", to: "/admin/tenants/new", icon: <PlusIcon className={GLYPH} />, primary: true },
  { label: "All Tenants", to: "/admin/tenants", icon: <GroupIcon className={GLYPH} /> },
  { label: "Payments", to: "/admin/payments", icon: <DollarLineIcon className={GLYPH} /> },
  { label: "Plans", to: "/admin/plans", icon: <BoxCubeIcon className={GLYPH} /> },
  { label: "Platform Config", to: "/admin/config", icon: <PlugInIcon className={GLYPH} /> },
  { label: "Admin Staff", to: "/admin/staff", icon: <UserCircleIcon className={GLYPH} /> },
  { label: "Audit Logs", to: "/admin/audit-logs", icon: <ListIcon className={GLYPH} /> },
  { label: "Banners", to: "/admin/banners", icon: <DocsIcon className={GLYPH} /> },
  { label: "Announcements", to: "/admin/announcements", icon: <MailIcon className={GLYPH} /> },
];

export function QuickActions() {
  return (
    <div className="flex flex-wrap gap-3">
      {ACTIONS.map((a) => (
        <Link
          key={a.to}
          to={a.to}
          // Creating a tenant is the one thing this console exists to do; it
          // gets the filled button and the rest get the quiet one.
          className={
            a.primary
              ? "inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-theme-sm font-semibold text-white shadow-theme-xs transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-600 hover:shadow-theme-md"
              : "inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-theme-sm font-medium text-gray-700 shadow-theme-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 hover:shadow-theme-md dark:border-gray-700 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10 dark:hover:text-brand-400"
          }
        >
          <span className={a.primary ? "text-white/90" : "text-gray-500 dark:text-gray-400"}>
            {a.icon}
          </span>
          {a.label}
        </Link>
      ))}
    </div>
  );
}
