import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../../../common/types/api";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { useToast } from "../../../components/ui/toast";
import { FilterTabs } from "../../../components/ui/tabs/FilterTabs";
import { platformMoney } from "../../../common/format/currency";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { FilterBar, FilterSelect, type AppliedFilter } from "../../../components/ui/filters";
import { useUrlFilters } from "../../../common/hooks/useUrlFilters";
import { AlertIcon, ChatIcon, TimeIcon, TruckIcon } from "../../../icons";
import { Card, Empty, PageHeader, Pill, StatTile } from "../components/kit";
import {
  FLAG_LABEL,
  ISSUE_KIND_LABEL,
  ordersDeskService,
  type DeliveryRules,
  type IssueOutcome,
  type LiveFilters,
  type LiveFlag,
  type LiveOrder,
  type OrderIssue,
} from "../services/ordersDeskService";

/**
 * ORDERS & DELIVERY — the platform's desk on launch day.
 *
 *   Live orders   every open marketplace order, the stuck ones flagged first;
 *                 asked again every 15 s; one may be cancelled with a reason
 *   Problems      what customers reported ("order mein masla"), answered with
 *                 a refund, a voucher at that shop, or a reasoned no
 *   Delivery &    the rules every shop follows unless it set its own: the
 *   fees          minimum basket and what happens below it, the per-km fee,
 *                 the service fee, the rain-or-rush fee, how long a shop has
 *                 to accept, and how much cash a pool rider may carry
 */

type Tab = "live" | "problems" | "rules";
const TABS = [
  { key: "live" as const, label: "Live orders", icon: <TruckIcon /> },
  { key: "problems" as const, label: "Problems", icon: <ChatIcon /> },
  { key: "rules" as const, label: "Delivery & fees", icon: <TimeIcon /> },
];

/** How often an open board asks again — the shop panel's own queue figure. */
export const LIVE_POLL_MS = 15_000;

const say = (e: unknown) => (e instanceof ApiError ? e.message : "That did not go through.");

export default function AdminOrdersDeskPage() {
  const { get, patch } = useUrlFilters();
  const tab = (["live", "problems", "rules"].includes(get("tab")) ? get("tab") : "live") as Tab;

  return (
    <>
      <PageMeta title="Orders & delivery" description="Live orders, customers' problems and the delivery rules" />
      <PageHeader
        icon={<TruckIcon />}
        tone="brand"
        title="Orders & delivery"
        subtitle="Every open order on the marketplace, the problems customers report, and what a delivery costs."
      />
      <FilterTabs tabs={TABS} value={tab} onChange={(k) => patch({ tab: k === "live" ? null : k })} className="mb-5" label="Show" />
      {tab === "live" && <LiveTab />}
      {tab === "problems" && <ProblemsTab />}
      {tab === "rules" && <RulesTab />}
    </>
  );
}

// ── Live orders ─────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "pending", label: "Waiting for the shop" },
  { value: "confirmed", label: "Accepted" },
  { value: "preparing", label: "Being prepared" },
  { value: "ready", label: "Ready to collect" },
  { value: "out_for_delivery", label: "On the way" },
];
const PAY_OPTIONS = [
  { value: "cod", label: "Cash on delivery" },
  { value: "transfer", label: "Transfer" },
];
const HOW_OPTIONS = [
  { value: "delivery", label: "Delivery" },
  { value: "pickup", label: "Pickup" },
];
const labelOf = (options: Array<{ value: string; label: string }>, value: string) => options.find((o) => o.value === value)?.label ?? value;

function LiveTab() {
  const [flag, setFlag] = useState<LiveFlag | null>(null);
  const [search, setSearch] = useState("");
  const [shop, setShop] = useState("");
  const [status, setStatus] = useState("");
  const [payment, setPayment] = useState("");
  const [how, setHow] = useState("");
  const debounced = useDebouncedValue(search.trim(), 300);
  const qc = useQueryClient();
  const toast = useToast();
  const filters: LiveFilters = { flag: flag ?? "", search: debounced, shop, status, payment, fulfillment: how };
  const board = useQuery({
    queryKey: ["admin", "live-orders", filters],
    queryFn: async () => (await ordersDeskService.live(filters)).data,
    refetchInterval: LIVE_POLL_MS,
    placeholderData: (previous) => previous,
  });
  const shops = board.data?.shops ?? [];
  const applied: AppliedFilter[] = [
    ...(flag ? [{ key: "flag", label: "Stuck", value: FLAG_LABEL[flag], onRemove: () => setFlag(null) }] : []),
    ...(shop ? [{ key: "shop", label: "Shop", value: shops.find((s) => s.id === shop)?.name ?? "This shop", onRemove: () => setShop("") }] : []),
    ...(status ? [{ key: "status", label: "Status", value: labelOf(STATUS_OPTIONS, status), onRemove: () => setStatus("") }] : []),
    ...(payment ? [{ key: "payment", label: "Payment", value: labelOf(PAY_OPTIONS, payment), onRemove: () => setPayment("") }] : []),
    ...(how ? [{ key: "how", label: "Handed over", value: labelOf(HOW_OPTIONS, how), onRemove: () => setHow("") }] : []),
  ];
  const narrowed = applied.length > 0 || debounced !== "";
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => ordersDeskService.cancel(id, reason),
    onSuccess: (r) => toast.success(r.message),
    onError: (e) => toast.error(say(e)),
    // A refusal means the board was old — re-read it either way.
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin", "live-orders"] }),
  });

  const counts = board.data?.counts;
  const tile = (f: LiveFlag, tone: "amber" | "red", icon: ReactNode) => (
    <StatTile
      label={FLAG_LABEL[f]}
      tone={counts && counts[f] > 0 ? tone : "slate"}
      icon={icon}
      loading={board.isLoading}
      value={counts?.[f] ?? 0}
      onPress={() => setFlag(flag === f ? null : f)}
      pressed={flag === f}
    />
  );

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Open orders" tone="brand" icon={<TruckIcon />} loading={board.isLoading} value={counts?.open ?? 0} onPress={() => setFlag(null)} pressed={flag === null} />
        {tile("shop_slow", "red", <AlertIcon />)}
        {tile("no_rider", "red", <TruckIcon />)}
        {tile("transfer_unchecked", "amber", <TimeIcon />)}
        {tile("late", "amber", <TimeIcon />)}
      </div>
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Order number, customer, phone or shop…", label: "Search live orders" }}
        applied={applied}
        onClearAll={() => { setFlag(null); setSearch(""); setShop(""); setStatus(""); setPayment(""); setHow(""); }}
        results={{ count: board.data?.orders.length, noun: "orders", loading: board.isLoading }}
      >
        <FilterSelect label="Any shop" value={shop} onChange={setShop} options={shops.map((s) => ({ value: s.id, label: s.name }))} />
        <FilterSelect label="Any status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        <FilterSelect label="Any payment" value={payment} onChange={setPayment} options={PAY_OPTIONS} />
        <FilterSelect label="Delivery or pickup" value={how} onChange={setHow} options={HOW_OPTIONS} />
      </FilterBar>
      <Card>
        {board.isError ? (
          <Empty icon={<TruckIcon />} title="The board could not be loaded" hint="Try again in a moment." action={<Button size="sm" variant="outline" onClick={() => board.refetch()}>Try again</Button>} />
        ) : !board.isLoading && (board.data?.orders.length ?? 0) === 0 ? (
          narrowed
            ? <Empty icon={<TruckIcon />} title="No open order matches" hint="Try fewer words, or clear the filters." />
            : <Empty icon={<TruckIcon />} title="No open orders right now" hint="The board asks again every 15 seconds." />
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800" data-testid="live-orders">
            {(board.data?.orders ?? []).map((o) => (
              <LiveRow key={o.id} order={o} busy={cancel.isPending} onCancel={(reason) => cancel.mutate({ id: o.id, reason })} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function LiveRow({ order: o, busy, onCancel }: { order: LiveOrder; busy: boolean; onCancel: (reason: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium text-gray-800 dark:text-white/90">
          {o.order_number}
          <span className="text-theme-sm font-normal text-gray-500">· {o.shop?.business_name}</span>
          <Pill tone="slate">{o.status.replace(/_/g, " ")}</Pill>
          {o.flags.map((f) => (
            <Pill key={f} tone={f === "shop_slow" || f === "no_rider" ? "red" : "amber"}>{FLAG_LABEL[f]}</Pill>
          ))}
        </p>
        <p className="text-theme-xs text-gray-500 dark:text-gray-400">
          {o.customer_name}{o.customer_phone ? ` · ${o.customer_phone}` : ""} · {o.fulfillment_type === "delivery" ? "Delivery" : "Pickup"} ·{" "}
          {o.payment_method === "transfer" ? "Transfer" : o.payment_method === "cod" ? "Cash on delivery" : "Paid"} · {platformMoney(Number(o.total))} ·{" "}
          {o.minutes} min ago{o.rider ? ` · Rider ${o.rider.name}${o.rider.accepted ? "" : " (not accepted yet)"}` : ""}
          {o.shop?.phone ? ` · Shop ${o.shop.phone}` : ""}
        </p>
      </div>
      {asking ? (
        <div className="flex w-full max-w-md items-center gap-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why — the customer and the shop read this" autoFocus />
          <Button size="sm" variant="outline" disabled={busy || reason.trim().length < 3} onClick={() => onCancel(reason.trim())}>Cancel order</Button>
          <Button size="sm" variant="outline" onClick={() => setAsking(false)}>Keep</Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAsking(true)}>Cancel…</Button>
      )}
    </li>
  );
}

// ── Problems ────────────────────────────────────────────────────────────

const KIND_OPTIONS = Object.entries(ISSUE_KIND_LABEL).map(([value, label]) => ({ value, label }));

function ProblemsTab() {
  const [status, setStatus] = useState<"open" | "resolved" | "rejected">("open");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const debounced = useDebouncedValue(search.trim(), 300);
  const issues = useQuery({
    queryKey: ["admin", "order-issues", status, debounced, kind],
    queryFn: async () => await ordersDeskService.issues(status, { search: debounced, kind }),
    placeholderData: (previous) => previous,
  });
  const applied: AppliedFilter[] = kind ? [{ key: "kind", label: "Problem", value: labelOf(KIND_OPTIONS, kind), onRemove: () => setKind("") }] : [];
  const list = issues.data?.data ?? [];
  const open = (issues.data?.meta as { open?: number } | undefined)?.open;

  return (
    <>
      <FilterTabs
        tabs={[
          { key: "open" as const, label: "Waiting for an answer", badge: open ? <span className="tabular-nums">{open}</span> : undefined },
          { key: "resolved" as const, label: "Refunded or vouchered" },
          { key: "rejected" as const, label: "Answered no" },
        ]}
        value={status}
        onChange={setStatus}
        className="mb-4"
        label="Problems"
      />
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Order number, customer, phone, shop or what they wrote…", label: "Search problems" }}
        applied={applied}
        onClearAll={() => { setSearch(""); setKind(""); }}
        results={{ count: issues.data?.meta?.total as number | undefined, noun: "problems", loading: issues.isLoading }}
      >
        <FilterSelect label="Any problem" value={kind} onChange={setKind} options={KIND_OPTIONS} />
      </FilterBar>
      <Card>
        {issues.isError ? (
          <Empty icon={<ChatIcon />} title="The list could not be loaded" hint="Try again in a moment." action={<Button size="sm" variant="outline" onClick={() => issues.refetch()}>Try again</Button>} />
        ) : !issues.isLoading && list.length === 0 ? (
          <Empty icon={<ChatIcon />} title={status === "open" ? "No problem is waiting" : "Nothing here yet"} hint="A customer reports one from their order, up to three days after it." />
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800" data-testid="order-issues">
            {list.map((i) => <IssueRow key={i.id} issue={i} />)}
          </ul>
        )}
      </Card>
    </>
  );
}

function IssueRow({ issue: i }: { issue: OrderIssue }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [outcome, setOutcome] = useState<IssueOutcome>("refund");
  const [amount, setAmount] = useState("");
  const [answer, setAnswer] = useState("");
  const resolve = useMutation({
    mutationFn: () => ordersDeskService.resolve(i.id, { outcome, amount: outcome === "none" ? null : Number(amount), answer: answer.trim() }),
    onSuccess: (r) => toast.success(r.message),
    onError: (e) => toast.error(say(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin", "order-issues"] }),
  });
  const ready = answer.trim().length >= 3 && (outcome === "none" || Number(amount) > 0);

  return (
    <li className="px-4 py-4">
      <p className="flex flex-wrap items-center gap-2 font-medium text-gray-800 dark:text-white/90">
        {i.kind_label}
        <span className="text-theme-sm font-normal text-gray-500">· {i.order.order_number} · {i.shop.business_name}</span>
        {i.status !== "open" && <Pill tone={i.status === "resolved" ? "green" : "slate"}>{i.outcome === "voucher" ? `Voucher ${i.voucher_code}` : i.outcome === "refund" ? "Refund" : "No"}</Pill>}
      </p>
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">
        {i.order.customer_name}{i.order.customer_phone ? ` · ${i.order.customer_phone}` : ""} · order {platformMoney(Number(i.order.total))}
      </p>
      {i.note && <p className="mt-1 text-theme-sm text-gray-700 dark:text-gray-300">“{i.note}”</p>}
      {i.status !== "open" ? (
        <p className="mt-1 text-theme-sm text-gray-600 dark:text-gray-400">
          {i.amount ? `${platformMoney(Number(i.amount))} · ` : ""}{i.answer}
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-[auto_8rem_1fr_auto] sm:items-end">
          <div>
            <Label>Answer</Label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as IssueOutcome)}
              className="h-11 rounded-lg border border-gray-300 bg-transparent px-3 text-theme-sm dark:border-gray-700 dark:text-white/90"
            >
              <option value="refund">Refund</option>
              <option value="voucher" disabled={!i.shop.takes_vouchers}>Voucher at the shop{i.shop.takes_vouchers ? "" : " (shop takes none)"}</option>
              <option value="none">No refund</option>
            </select>
          </div>
          <div>
            <Label>Amount</Label>
            <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={outcome === "none"} />
          </div>
          <div>
            <Label>What the customer reads</Label>
            <Input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Sorry about the missing raita — …" />
          </div>
          <Button size="sm" disabled={!ready || resolve.isPending} onClick={() => resolve.mutate()}>Send answer</Button>
        </div>
      )}
    </li>
  );
}

// ── Delivery & fees ─────────────────────────────────────────────────────

type Draft = Record<keyof DeliveryRules, string | boolean>;

function RulesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const rules = useQuery({ queryKey: ["admin", "delivery-rules"], queryFn: async () => (await ordersDeskService.rules()).data });
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (rules.data && draft === null) {
      setDraft(Object.fromEntries(Object.entries(rules.data).map(([k, v]) => [k, typeof v === "boolean" ? v : v === null ? "" : String(v)])) as Draft);
    }
  }, [rules.data, draft]);

  const save = useMutation({
    mutationFn: () => {
      const d = draft!;
      const num = (k: keyof DeliveryRules) => (String(d[k]).trim() === "" ? null : Number(d[k]));
      return ordersDeskService.saveRules({
        default_min_order: num("default_min_order"),
        below_minimum: d.below_minimum as "fee" | "refuse",
        delivery_fee_per_km: num("delivery_fee_per_km"),
        delivery_fee_base_km: num("delivery_fee_base_km") ?? 0,
        service_fee: num("service_fee") ?? 0,
        rush_fee: num("rush_fee") ?? 0,
        rush_fee_on: Boolean(d.rush_fee_on),
        accept_within_minutes: num("accept_within_minutes") ?? 0,
        rider_cash_limit: num("rider_cash_limit"),
      });
    },
    onSuccess: (r) => { toast.success(r.message); setDraft(null); },
    onError: (e) => toast.error(say(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin", "delivery-rules"] }),
  });

  if (rules.isError) {
    return <Card><Empty icon={<TimeIcon />} title="The rules could not be loaded" hint="Try again in a moment." action={<Button size="sm" variant="outline" onClick={() => rules.refetch()}>Try again</Button>} /></Card>;
  }
  if (!draft) return <Card><div className="h-64 animate-pulse" /></Card>;

  const set = (k: keyof DeliveryRules) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft({ ...draft, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const field = (k: keyof DeliveryRules, label: string, hint: string, placeholder = "") => (
    <div>
      <Label htmlFor={`rule-${k}`}>{label}</Label>
      <Input id={`rule-${k}`} type="number" min="0" value={String(draft[k])} onChange={set(k)} placeholder={placeholder} />
      <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">{hint}</p>
    </div>
  );

  return (
    <Card className="p-5">
      <p className="mb-5 max-w-3xl text-theme-sm text-gray-500 dark:text-gray-400">
        These apply to every shop that has not set its own in its settings. Orders a shop takes on the phone are never charged these fees.
      </p>
      <div className="grid gap-5 md:grid-cols-2" data-testid="delivery-rules">
        {field("default_min_order", "Minimum order for delivery", "Leave empty for none. A shop's own minimum wins.", "No minimum")}
        <div>
          <Label htmlFor="rule-below_minimum">Below the minimum</Label>
          <select
            id="rule-below_minimum"
            value={String(draft.below_minimum)}
            onChange={set("below_minimum")}
            className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-theme-sm dark:border-gray-700 dark:text-white/90"
          >
            <option value="fee">Let them order — charge the difference as a small order fee</option>
            <option value="refuse">Refuse the order</option>
          </select>
          <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">The small order fee goes to the shop.</p>
        </div>
        {field("delivery_fee_per_km", "Extra per km", "Added to the shop's delivery fee for every km past the distance below. Empty = flat fee.", "Flat fee only")}
        {field("delivery_fee_base_km", "Km the flat fee covers", "Distance from the shop to the customer's pin.")}
        {field("service_fee", "Service fee (yours)", "Added to every online order and billed back to the shop with its commission. 0 = none.")}
        {field("accept_within_minutes", "Shop must accept within (minutes)", "Otherwise the order is cancelled and the customer told. Transfers get twice as long. 0 = never.")}
        {field("rider_cash_limit", "Cash a pool rider may carry", "Above this they get no pool orders until they hand cash in. Empty = no limit.", "No limit")}
        <div>
          {field("rush_fee", "Rain / rush fee", "Added to every delivery while switched on. Goes to the rider who keeps the fee.")}
          <label className="mt-2 flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={Boolean(draft.rush_fee_on)} onChange={set("rush_fee_on")} className="size-4" />
            Charging the rush fee now
          </label>
        </div>
      </div>
      <div className="mt-6 flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save rules</Button>
        <Button variant="outline" onClick={() => setDraft(null)} disabled={save.isPending}>Undo changes</Button>
      </div>
    </Card>
  );
}
