import { Link } from "react-router";

import type { TenantDashboard } from "../../types";
import type { Capabilities } from "./capabilities";
import { SectionCard } from "./SectionCard";

type Tone = "brand" | "warning" | "error" | "success" | "gray";

const TILE: Record<Tone, string> = {
  brand: "bg-brand-50 hover:bg-brand-100 dark:bg-brand-500/10 dark:hover:bg-brand-500/15",
  warning: "bg-warning-50 hover:bg-warning-100 dark:bg-warning-500/10 dark:hover:bg-warning-500/15",
  error: "bg-error-50 hover:bg-error-100 dark:bg-error-500/10 dark:hover:bg-error-500/15",
  success: "bg-success-50 hover:bg-success-100 dark:bg-success-500/10 dark:hover:bg-success-500/15",
  gray: "bg-gray-50 hover:bg-gray-100 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]",
};

const NUMBER: Record<Tone, string> = {
  brand: "text-brand-600 dark:text-brand-400",
  warning: "text-warning-600 dark:text-warning-500",
  error: "text-error-600 dark:text-error-500",
  success: "text-success-600 dark:text-success-500",
  gray: "text-gray-800 dark:text-white/90",
};

interface Props {
  data: TenantDashboard;
  caps: Capabilities;
  money: (n: number) => string;
}

/** The page needs this to decide whether to draw the row at all. */
export function hasMoneyPanel(data: TenantDashboard, caps: Capabilities): boolean {
  const { receivable, payable } = data.money_owed;
  return (caps.sells && caps.visit("/tenant/customers") && receivable.accounts > 0)
    || (caps.tracksStock && caps.visit("/tenant/suppliers") && payable.accounts > 0)
    || (data.till !== null && caps.visit("/tenant/day"));
}

/**
 * The shop's cash position right now.
 *
 * Straight after "what did I take today" comes "who owes me" and "who am I
 * about to owe" — both already recorded, neither ever shown anywhere a
 * shopkeeper looks daily. The till tiles sit beside them because banking is the
 * same question one step later: the takings are not really takings until
 * they're somewhere safe.
 *
 * Who sees which tile follows who may open the screen behind it. In practice
 * that means the shop's total khata and its supplier dues are the owner's
 * figures — a cashier needs ONE customer's balance, which the till already
 * gives them, not the shop's whole position. The day and the banking stay,
 * because that is the cashier's own drawer.
 */
export function MoneyPanel({ data, caps, money }: Props) {
  const { receivable, payable } = data.money_owed;
  // A till the person cannot open is a till they are told nothing about.
  const till = caps.visit("/tenant/day") ? data.till : null;

  const tiles: Array<{
    key: string;
    label: string;
    value: string;
    caption: string;
    tone: Tone;
    to: string;
  }> = [];

  if (caps.sells && caps.visit("/tenant/customers")) {
    tiles.push({
      key: "receivable",
      label: "Owed to you",
      value: money(receivable.total),
      caption:
        receivable.accounts === 0
          ? "nothing out on khata"
          : `${receivable.accounts} ${receivable.accounts === 1 ? "account" : "accounts"} on khata`,
      tone: receivable.total > 0 ? "warning" : "gray",
      to: "/tenant/customers",
    });
  }

  if (caps.tracksStock && caps.visit("/tenant/suppliers")) {
    tiles.push({
      key: "payable",
      label: "You owe",
      value: money(payable.total),
      caption:
        payable.accounts === 0
          ? "all suppliers settled"
          : `${payable.accounts} ${payable.accounts === 1 ? "supplier" : "suppliers"} waiting`,
      tone: payable.total > 0 ? "error" : "gray",
      to: "/tenant/suppliers",
    });
  }

  if (till) {
    tiles.push({
      key: "banked",
      label: "Banked today",
      value: money(till.banked_today),
      caption: till.banked_today > 0 ? "gone to the bank" : "nothing banked yet",
      tone: till.banked_today > 0 ? "success" : "gray",
      to: "/tenant/day",
    });
    tiles.push({
      key: "day",
      label: "Trading day",
      value: till.day_open ? "Open" : "Not started",
      caption: till.day_open
        ? till.open_shifts === 0
          ? "every shift counted out"
          : `${till.open_shifts} ${till.open_shifts === 1 ? "shift" : "shifts"} still on the till`
        : "opens when a cashier opens a drawer",
      tone: till.day_open && till.open_shifts > 0 ? "brand" : "gray",
      to: "/tenant/day",
    });
  }

  if (tiles.length === 0) return null;

  return (
    <SectionCard
      title="Money & the till"
      subtitle={data.branch_scope ? "This branch" : undefined}
      to={till ? "/tenant/day" : undefined}
      toLabel="Open Day"
    >
      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${
          tiles.length >= 4 ? "xl:grid-cols-4" : tiles.length === 3 ? "xl:grid-cols-3" : ""
        }`}
      >
        {tiles.map((tile) => (
          <Link key={tile.key} to={tile.to} className={`rounded-xl p-4 transition-colors ${TILE[tile.tone]}`}>
            <p className={`text-xl font-bold tabular-nums ${NUMBER[tile.tone]}`}>{tile.value}</p>
            <p className="mt-1 text-theme-sm font-medium text-gray-700 dark:text-gray-300">{tile.label}</p>
            <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">{tile.caption}</p>
          </Link>
        ))}
      </div>
    </SectionCard>
  );
}
