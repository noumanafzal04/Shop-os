import { useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import { FilterBar } from "../../../components/ui/filters";
import Badge from "../../../components/ui/badge/Badge";
import { useMoney } from "../../shop/hooks/useShop";
import { useDocumentSummary, useDocuments } from "../hooks/useDocuments";
import type { DocumentKind, SaleDocument } from "../services/documentService";
import { usePrimaryBusinessType } from "../../../common/tenant/businessType";
import { boardWords, hasJobBoard, type BoardWords } from "../../workshop/words";
import { isPastDate } from "../../../common/shopDay";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { shopDate } from "../../../common/format/date";
import Button from "../../../components/ui/button/Button";
import { useShopSettings } from "../../shop/hooks/useShop";
import NewDocumentSheet from "../components/NewDocumentSheet";
import { advanceRow } from "../advanceRow";
import { sinceWords } from "../../../common/format/since";
import type { DocumentSummary } from "../services/documentService";

const CHIP_ON = {
  brand: "border-brand-500 bg-brand-500 text-white",
  error: "border-error-500 bg-error-500 text-white",
  warning: "border-warning-500 bg-warning-500 text-white",
  success: "border-success-500 bg-success-500 text-white",
} as const;

const countFor = (c: DocumentSummary["layaway_counts"], status: string): number | undefined =>
  c === undefined ? undefined
    : status === "open" ? c.open : status === "lapsed" ? c.overdue : status === "quiet" ? c.quiet : status === "paid_up" ? c.paid_up : undefined;

/**
 * WHICH KINDS THIS SHOP ACTUALLY WRITES.
 *
 * ── The job card had no tab at all ──────────────────────────────────────
 *
 * Three document kinds exist — layaway, quotation and job card — and this
 * screen offered two. The workshop board shows job cards at `status: "open"`
 * and nothing else, so a FINISHED job card was reachable from nowhere in the
 * whole panel. On a shop with 45 of them, 27 were invisible: every car that
 * had been collected and every job that was called off. "What did we do for
 * this customer last March" had no answer.
 *
 * The same shape this codebase keeps producing — the API accepted `job_card`
 * from the first day, and one screen never asked for it.
 *
 * ── And the first tab follows the trade ─────────────────────────────────
 *
 * It was layaway for everybody. A workshop's layaways are usually all closed,
 * so a garage with ninety documents opened this screen and saw an empty
 * table with "Nothing is being held right now" — which is true of layaways
 * and false of the shop.
 */
function tabsFor(businessType: string | null, words: BoardWords): Array<[DocumentKind, string]> {
  const tabs: Array<[DocumentKind, string]> = [];

  // A trade that takes work in leads with it — it is the day's work, and the
  // other two are occasional.
  if (hasJobBoard(businessType)) tabs.push(["job_card", words.units]);

  tabs.push(["layaway", "On advance"], ["quotation", "Quotations"]);

  return tabs;
}

/**
 * The counter's list of promises outstanding.
 *
 * The headline it leads with is deliberate: not "how many documents" but how
 * much of the CUSTOMERS' money the shop is sitting on. That figure is in the
 * till, it isn't revenue, and it is the one number a shopkeeper running layaway
 * has no other way to see.
 */
const DOC_STATUSES = [
  { value: "open", label: "Open" },
  { value: "lapsed", label: "Overdue" },
  { value: "converted", label: "Collected" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * Goods on advance get two more (L17): the ones paid in full and waiting to be
 * handed over, and the ones nobody has paid into for 30 days.
 */
const ADVANCE_STATUSES = [
  { value: "open", label: "Open" },
  { value: "lapsed", label: "Overdue" },
  { value: "quiet", label: "Not paid 30+ days" },
  { value: "paid_up", label: "Paid up — hand over" },
  { value: "converted", label: "Collected" },
  { value: "cancelled", label: "Cancelled" },
];

export default function DocumentsPage() {
  const trade = usePrimaryBusinessType();
  const words = boardWords(trade);
  const tabs = tabsFor(trade, words);

  const [kind, setKind] = useState<DocumentKind>(tabs[0][0]);
  const [status, setStatus] = useState<string>("open");
  const [search, setSearch] = useState("");

  const money = useMoney();
  const settings = useShopSettings();
  // Started here, not only at the till (the user, 2026-10-15).
  const [starting, setStarting] = useState<DocumentKind | null>(null);
  const quotesOn = settings.data?.quotations_enabled !== false;
  const layawayOn = settings.data?.layaway_enabled !== false;
  const summary = useDocumentSummary();
  const list = useDocuments({ kind, status, search });
  const rows = list.data?.rows ?? [];

  return (
    <>
      <PageMeta title="Quotations & advances" description="Quotations and goods held on advance" />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Quotations &amp; advances</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Prices you've promised, and goods you're holding until they're paid for.
          </p>
        </div>
        <div className="flex gap-2">
          {layawayOn && (
            <Button size="sm" variant="outline" onClick={() => setStarting("layaway")}>Hold goods on advance</Button>
          )}
          {quotesOn && <Button size="sm" onClick={() => setStarting("quotation")}>New quotation</Button>}
        </div>
      </div>

      <NewDocumentSheet
        isOpen={starting !== null}
        onClose={() => setStarting(null)}
        startAs={starting ?? "quotation"}
        onSaved={(saved) => { setKind(saved); setStatus("open"); }}
      />

      {/* ── What's outstanding ─────────────────────────────────────── */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Advances held"
          value={money(summary.data?.deposits_held ?? 0)}
          hint="Customers' money in your till — not yet earned"
          tone="brand"
        />
        <Tile
          label="Still to collect"
          value={money(summary.data?.balance_outstanding ?? 0)}
          hint={`Across ${summary.data?.open_layaways ?? 0} booking${summary.data?.open_layaways === 1 ? "" : "s"}`}
          onClick={tabs.some(([k]) => k === "layaway") ? () => { setKind("layaway"); setStatus("open"); } : undefined}
        />
        <Tile
          label="Open quotations"
          value={String(summary.data?.open_quotations ?? 0)}
          hint="Prices you're still standing behind"
          onClick={tabs.some(([k]) => k === "quotation") ? () => { setKind("quotation"); setStatus("open"); } : undefined}
        />
        <Tile
          label="Overdue"
          value={String(summary.data?.overdue ?? 0)}
          hint="Past the date — worth a phone call"
          tone={(summary.data?.overdue ?? 0) > 0 ? "warn" : undefined}
          onClick={() => setStatus("lapsed")}
        />
      </div>

      {/* ── Filters ────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-gray-200 p-1 dark:border-gray-700">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => { setKind(key); if (key !== "layaway" && (status === "quiet" || status === "paid_up")) setStatus("open"); }}
              className={`rounded-md px-3.5 py-1.5 text-theme-sm font-medium transition ${
                kind === key
                  ? "bg-brand-500 text-white"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

      </div>

      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show" data-testid="document-filters">
        {(kind === "layaway" ? ADVANCE_STATUSES : DOC_STATUSES).map(({ value, label }) => {
          const n = kind === "layaway" ? countFor(summary.data?.layaway_counts, value) : undefined;
          const on = status === value;
          const tone = value === "paid_up" ? "success" : value === "lapsed" ? "error" : value === "quiet" ? "warning" : "brand";

          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              onClick={() => setStatus(value)}
              className={`rounded-full border px-3 py-1.5 text-theme-sm font-medium transition ${
                on ? CHIP_ON[tone] : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
              }`}
            >
              {label}{n != null && <span className={`ml-1.5 tabular-nums ${on ? "text-white/80" : "text-gray-400"}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Number, customer or phone…",
          label: "Search documents",
        }}
      />

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
        {list.isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <ListEmpty from={list} what="the documents">
            <p className="py-14 text-center text-theme-sm text-gray-500 dark:text-gray-400">
              {kind === "layaway"
                ? "Nothing is being held right now. Take an advance from the till to start one."
                : kind === "job_card"
                  /* Named by the status actually being looked at. "No job cards"
                     under a filter set to Cancelled is a sentence that makes a
                     shopkeeper doubt their own records. */
                  ? `No ${words.units.toLowerCase()} with this status.`
                  : "No quotations here. Write one from the till with a cart on screen."}
            </p>
          </ListEmpty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-theme-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                  <th className="px-5 py-2.5 font-medium">Number</th>
                  <th className="px-3 py-2.5 font-medium">Customer</th>
                  <th className="px-3 py-2.5 font-medium">Items</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total</th>
                  {kind === "layaway" && <th className="px-3 py-2.5 font-medium">Paid</th>}
                  {kind === "layaway" && <th className="px-3 py-2.5 text-right font-medium">Left to pay</th>}
                  {kind === "layaway" && <th className="px-3 py-2.5 font-medium">Last paid</th>}
                  {/* The same column means three different things, so it is
                      named three ways. "Valid until" over a job card's
                      promised date is a quotation's word on a car that is
                      sitting in the bay. */}
                  <th className="px-5 py-2.5 font-medium">
                    {kind === "layaway" ? "Collect by" : kind === "job_card" ? "Promised" : "Valid until"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((doc) => (
                  <Row key={doc.id} doc={doc} kind={kind} money={money} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Row({
  doc,
  kind,
  money,
}: {
  doc: SaleDocument;
  kind: DocumentKind;
  money: (n: string | number) => string;
}) {
  // Past its date on the shop's wall — the rule the server's own "lapsed"
  // list uses, so a row is never overdue here and live there.
  const overdue = doc.status === "open" && isPastDate(doc.expires_at);
  const summary = (doc.items ?? []).map((i) => i.product_name).join(", ");
  const adv = advanceRow(doc);
  const tint = kind !== "layaway" ? "hover:bg-gray-50 dark:hover:bg-white/[0.02]"
    : adv.state === "paid_up" ? "bg-success-50/60 hover:bg-success-50 dark:bg-success-500/[0.06]"
      : adv.state === "overdue" ? "bg-error-50/50 hover:bg-error-50 dark:bg-error-500/[0.06]"
        : "hover:bg-gray-50 dark:hover:bg-white/[0.02]";

  return (
    <tr className={`border-b border-gray-100 last:border-0 dark:border-gray-800 ${tint}`} data-state={kind === "layaway" ? adv.state : undefined}>
      <td className="px-5 py-3">
        <Link to={`/tenant/documents/${doc.id}`} className="font-medium text-brand-500 hover:text-brand-600">
          {doc.number}
        </Link>
        <div className="mt-0.5 flex items-center gap-1.5">
          {doc.status === "converted" && <Badge size="sm" color="success">Collected</Badge>}
          {doc.status === "cancelled" && <Badge size="sm" color="light">Cancelled</Badge>}
          {overdue && <Badge size="sm" color="warning">Overdue</Badge>}
        </div>
      </td>
      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
        {doc.customer_name ?? "—"}
        {doc.customer_phone && (
          <a href={`tel:${doc.customer_phone}`} className="block text-theme-xs text-brand-500 hover:text-brand-600">
            {doc.customer_phone}
          </a>
        )}
      </td>
      <td className="max-w-[18rem] truncate px-3 py-3 text-theme-xs text-gray-500 dark:text-gray-400" title={summary}>
        {summary || "—"}
      </td>
      <td className="px-3 py-3 text-right tabular-nums text-gray-800 dark:text-white/90">{money(doc.total)}</td>
      {kind === "layaway" && (
        <td className="px-3 py-3">
          <div className="flex items-center gap-2" title={`${Math.round(adv.share * 100)}% paid`}>
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div className={`h-full rounded-full ${adv.state === "paid_up" ? "bg-success-500" : "bg-brand-500"}`} style={{ width: `${Math.round(adv.share * 100)}%` }} />
            </div>
            <span className="tabular-nums text-gray-600 dark:text-gray-300">{money(adv.paid)}</span>
            <span className="text-theme-xs tabular-nums text-gray-400">{Math.round(adv.share * 100)}%</span>
          </div>
        </td>
      )}
      {kind === "layaway" && (
        <td className="px-3 py-3 text-right">
          {adv.state === "paid_up" ? (
            <Link to={`/tenant/documents/${doc.id}`} className="inline-block rounded-full bg-success-500 px-2.5 py-1 text-theme-xs font-semibold text-white hover:bg-success-600">
              Paid up — hand over
            </Link>
          ) : adv.state === "collected" || adv.state === "cancelled" ? (
            <span className="tabular-nums text-gray-400">{money(adv.left)}</span>
          ) : (
            <span className={`font-semibold tabular-nums ${adv.state === "overdue" ? "text-error-600 dark:text-error-400" : "text-warning-600 dark:text-warning-400"}`}>
              {money(adv.left)}
            </span>
          )}
        </td>
      )}
      {kind === "layaway" && (
        <td className={`px-3 py-3 text-theme-xs ${adv.quiet ? "font-medium text-warning-600 dark:text-warning-400" : "text-gray-500 dark:text-gray-400"}`} title={doc.last_paid_at ? shopDate(doc.last_paid_at) : undefined}>
          {sinceWords(doc.last_paid_at) ?? "—"}
        </td>
      )}
      <td className={`px-5 py-3 text-theme-xs ${overdue ? "font-medium text-error-600 dark:text-error-400" : "text-gray-500 dark:text-gray-400"}`}>
        {doc.expires_at ? shopDate(doc.expires_at) : "No expiry"}
      </td>
    </tr>
  );
}


function Tile({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "brand" | "warn";
  /** A tile that is a list opens that list. */
  onClick?: () => void;
}) {
  const accent =
    tone === "brand"
      ? "text-brand-500"
      : tone === "warn"
        ? "text-warning-500"
        : "text-gray-800 dark:text-white/90";

  const body = (
    <>
      <div className="text-theme-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent}`}>{value}</div>
      <div className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">{hint}</div>
    </>
  );
  const shell = "rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]";

  return onClick ? (
    <button type="button" onClick={onClick} className={`${shell} transition hover:border-brand-300 hover:bg-brand-50/30 dark:hover:border-brand-500/40`}>{body}</button>
  ) : (
    <div className={shell}>{body}</div>
  );
}
