import type { ReactNode } from "react";
import { Link } from "react-router";

import {
  AlertIcon,
  AngleRightIcon,
  BoxIconLine,
  CalenderIcon,
  CheckCircleIcon,
  DollarLineIcon,
  ErrorHexaIcon,
  TaskIcon,
  TimeIcon,
} from "../../../../icons";
import type { TenantDashboard } from "../../types";
import type { Capabilities } from "./capabilities";
import { formatDate } from "./format";
import { SectionCard } from "./SectionCard";

type Severity = "critical" | "warning" | "info";

const ROW: Record<Severity, string> = {
  critical: "bg-error-50 hover:bg-error-100 dark:bg-error-500/10 dark:hover:bg-error-500/15",
  warning: "bg-warning-50 hover:bg-warning-100 dark:bg-warning-500/10 dark:hover:bg-warning-500/15",
  info: "bg-brand-50 hover:bg-brand-100 dark:bg-brand-500/10 dark:hover:bg-brand-500/15",
};

const ICON: Record<Severity, string> = {
  critical: "bg-error-100 text-error-600 dark:bg-error-500/20 dark:text-error-500",
  warning: "bg-warning-100 text-warning-600 dark:bg-warning-500/20 dark:text-warning-500",
  info: "bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400",
};

interface Item {
  key: string;
  severity: Severity;
  title: string;
  detail: string;
  icon: ReactNode;
  /** Absent when the tenant has no screen for it (e.g. phone orders, no marketplace). */
  to?: string;
}

interface Props {
  data: TenantDashboard;
  caps: Capabilities;
}

/**
 * Every row here is derived from a real figure in the payload — nothing is
 * shown "as an example". An empty list is a result, not a failure, so it says
 * so plainly instead of hiding the card.
 */
export function AttentionPanel({ data, caps }: Props) {
  const items: Item[] = [];

  if (data.subscription_state === "read_only") {
    items.push({
      key: "read_only",
      severity: "critical",
      title: "Subscription expired — read-only mode",
      detail: "You can view everything, but changes are blocked until you renew.",
      icon: <DollarLineIcon className="size-5" />,
      to: "/tenant/subscription",
    });
  } else if (data.subscription_state === "grace") {
    items.push({
      key: "grace",
      severity: "warning",
      title: "Subscription in grace period",
      detail: data.grace_ends_at
        ? `Everything keeps working until ${formatDate(data.grace_ends_at)}.`
        : "Renew now to avoid read-only mode.",
      icon: <TimeIcon className="size-5" />,
      to: "/tenant/subscription",
    });
  }

  if (!data.setup_completed) {
    items.push({
      key: "setup",
      severity: "warning",
      title: "Shop setup is incomplete",
      detail: "Finish setup so receipts, taxes and your storefront details are right.",
      icon: <TaskIcon className="size-5" />,
      to: "/tenant/setup",
    });
  }

  if (caps.tracksStock && data.inventory.out_of_stock > 0) {
    items.push({
      key: "out_of_stock",
      severity: "critical",
      title: `${data.inventory.out_of_stock} ${
        data.inventory.out_of_stock === 1 ? "item is" : "items are"
      } out of stock`,
      detail: "Nothing left to sell until you restock.",
      icon: <ErrorHexaIcon className="size-5" />,
      to: "/tenant/inventory",
    });
  }

  if (caps.tracksStock && data.inventory.expiring_soon > 0) {
    items.push({
      key: "expiring",
      severity: "critical",
      title: `${data.inventory.expiring_soon} ${
        data.inventory.expiring_soon === 1 ? "batch is" : "batches are"
      } expiring`,
      detail: "Within 30 days, or already expired — pull or discount them.",
      icon: <CalenderIcon className="size-5" />,
      to: "/tenant/inventory",
    });
  }

  if (caps.tracksStock && data.inventory.low_stock > 0) {
    items.push({
      key: "low_stock",
      severity: "warning",
      title: `${data.inventory.low_stock} ${
        data.inventory.low_stock === 1 ? "item is" : "items are"
      } running low`,
      detail: "At or below the reorder level you set.",
      icon: <BoxIconLine className="size-5" />,
      to: "/tenant/inventory",
    });
  }

  if (caps.takesOrders && data.pending_orders > 0) {
    items.push({
      key: "pending_orders",
      severity: "warning",
      title: `${data.pending_orders} ${data.pending_orders === 1 ? "order" : "orders"} still open`,
      detail: "Not completed or cancelled yet.",
      icon: <TaskIcon className="size-5" />,
      // Phone-order (delivery-only) shops have no Orders screen to send them to.
      to: caps.marketplace ? "/tenant/orders" : undefined,
    });
  }

  if (caps.reservations && data.pending_reservations > 0) {
    items.push({
      key: "reservations",
      severity: "info",
      title: `${data.pending_reservations} ${
        data.pending_reservations === 1 ? "reservation" : "reservations"
      } awaiting confirmation`,
      detail: "Stock stays held until you confirm or they expire.",
      icon: <TimeIcon className="size-5" />,
      to: "/tenant/reservations",
    });
  }

  // A day left open never gets its roll-up, so the shop's record of that day
  // quietly does not exist — and nothing else in the product would ever
  // mention it. By the time anyone goes looking for the figure it is months
  // too late to reconstruct.
  if (data.till?.unclosed_day) {
    items.push({
      key: "unclosed_day",
      severity: "critical",
      title:
        data.till.unclosed_days === 1
          ? `${formatDate(data.till.unclosed_day)} was never closed off`
          : `${data.till.unclosed_days} trading days were never closed off`,
      detail: "Until a day is closed, it has no record of what the shop took.",
      icon: <CalenderIcon className="size-5" />,
      to: "/tenant/day",
    });
  }

  if (caps.pos && data.inventory.pending_pos > 0) {
    items.push({
      key: "parked",
      severity: "info",
      title: `${data.inventory.pending_pos} parked ${
        data.inventory.pending_pos === 1 ? "ticket" : "tickets"
      } at the till`,
      detail: "Held sales waiting to be settled.",
      icon: <DollarLineIcon className="size-5" />,
      to: "/tenant/pos",
    });
  }

  if (caps.catalog && data.products_count === 0) {
    items.push({
      key: "no_products",
      severity: "warning",
      title: caps.products ? "No active products yet" : "No active services yet",
      detail: "Add what you sell so you can start ringing up sales.",
      icon: <BoxIconLine className="size-5" />,
      to: "/tenant/products",
    });
  }

  if (caps.keepsBooks && !caps.sells && data.recent_expenses.length === 0) {
    items.push({
      key: "no_expenses",
      severity: "info",
      title: "No expenses recorded yet",
      detail: "Log your first expense to start seeing where the money goes.",
      icon: <AlertIcon className="size-5" />,
      to: "/tenant/expenses",
    });
  }

  return (
    <SectionCard title="Attention needed">
      {items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl bg-success-50 px-4 py-4 dark:bg-success-500/10">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success-100 text-success-600 dark:bg-success-500/20 dark:text-success-500">
            <CheckCircleIcon className="size-5" />
          </span>
          <p className="text-theme-sm text-gray-700 dark:text-gray-300">
            Nothing needs your attention right now.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const body = (
              <>
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${ICON[item.severity]}`}
                >
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-theme-sm font-medium text-gray-800 dark:text-white/90">
                    {item.title}
                  </span>
                  <span className="block text-theme-xs text-gray-500 dark:text-gray-400">
                    {item.detail}
                  </span>
                </span>
                {item.to && (
                  <AngleRightIcon className="mt-1 size-4 shrink-0 text-gray-400 dark:text-gray-500" />
                )}
              </>
            );

            return (
              <li key={item.key}>
                {item.to ? (
                  <Link
                    to={item.to}
                    className={`flex items-start gap-3 rounded-xl p-4 transition-colors ${ROW[item.severity]}`}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className={`flex items-start gap-3 rounded-xl p-4 ${ROW[item.severity]}`}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
