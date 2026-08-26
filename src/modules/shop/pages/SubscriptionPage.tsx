import { Link } from "react-router";

import { downloadCsv } from "../../../common/api/download";
import PageMeta from "../../../components/common/PageMeta";
import Badge from "../../../components/ui/badge/Badge";
import { useSubscription } from "../hooks/useShop";
import type { SubscriptionInfo } from "../services/shopService";

/**
 * Platform billing is in rupees regardless of what the shop sells in —
 * `currency_symbol` is a per-tenant SHOP setting and means nothing about what
 * this business pays CartZe. Same reasoning as the admin console's `money`.
 */
const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Whole days from today to `iso`. Negative = it has already passed. */
function daysUntil(iso: string): number {
  const then = new Date(iso);
  const midnight = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const today = new Date();

  return Math.round(
    (midnight.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000,
  );
}

/** "in 17 days" / "tomorrow" / "6 days ago" — the arithmetic the reader was
 *  going to do anyway. A date alone makes them do it. */
function whenPhrase(iso: string): string {
  const days = daysUntil(iso);

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return `in ${days} days`;

  return `${Math.abs(days)} days ago`;
}

/**
 * THE SHOP'S OWN SUBSCRIPTION.
 *
 * ── What was wrong with it ─────────────────────────────────────────────
 *
 * Three equal cards, and the single most important fact on the screen — what
 * state this subscription is in — was a small badge in the corner of one of
 * them. A shop that has gone read-only is a shop that cannot ring a sale, and
 * it was being told so in eleven-pixel type beside its plan name.
 *
 * The renewal date was a date. "12/09/2026" makes the reader work out how long
 * they have; "in 17 days" is what they were going to work out.
 *
 * And "What your shop runs" listed three modules from a map of eleven, because
 * the labels were a lookup table typed into this file. A restaurant was never
 * told it had dine-in. That list now comes from the server's own registry.
 *
 * ── What it does now ───────────────────────────────────────────────────
 *
 * Leads with the state, in the words and the colour it deserves, and says what
 * to do about it. Everything else follows in the order it is asked about:
 * what am I paying, what can I use, how close am I to a ceiling, what have I
 * paid.
 *
 * Still read-only. Plans are assigned by the platform, and a page that offered
 * an Upgrade button leading to "contact support" would be a worse version of
 * saying so plainly.
 */
export default function SubscriptionPage() {
  const sub = useSubscription();
  const data = sub.data;

  if (sub.isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="h-28 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
          ))}
        </div>
      </div>
    );
  }

  const metered = data.limits_usage.filter((u) => u.enforced || !u.unlimited);
  const modules = data.modules_on ?? [];

  return (
    <>
      <PageMeta title="Subscription | CartZe" description="Your plan and usage" />

      <div className="mb-5">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Subscription</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Where your shop stands, what it can use, and what has been paid.
        </p>
      </div>

      <StandingBanner data={data} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Your plan">
          {data.plan === null ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No plan on your shop yet — no catalogue ceiling and no billing period. Nothing is
              limited in the meantime; the platform team will set one up.
            </p>
          ) : (
            <>
              <p className="text-title-sm font-bold text-gray-800 dark:text-white/90">{data.plan.name}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {money(data.plan.price)} every{" "}
                {data.plan.billing_period_months === 1
                  ? "month"
                  : `${data.plan.billing_period_months} months`}
              </p>
              {data.plan.description && (
                <p className="mt-3 text-theme-sm text-gray-600 dark:text-gray-300">{data.plan.description}</p>
              )}
              {data.plan.is_custom && (
                <p className="mt-3 inline-flex rounded-lg bg-brand-50 px-2.5 py-1 text-theme-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                  Arranged for your business
                </p>
              )}
              <dl className="mt-4 space-y-2 border-t border-gray-100 pt-4 text-theme-sm dark:border-gray-800">
                {data.subscription_ends_at && (
                  <Row
                    label={data.state === "active" ? "Renews" : "Ran out"}
                    value={`${day(data.subscription_ends_at)} · ${whenPhrase(data.subscription_ends_at)}`}
                  />
                )}
                <Row
                  label="If a payment is late"
                  value={`${data.plan.grace_period_days} days of grace`}
                />
              </dl>
            </>
          )}
        </Card>

        {/* WHAT THE SHOP CAN DO is separate from what it pays, and that is the
            whole reason this is its own card rather than a line inside the
            plan: putting it there implied the plan granted it. It does not,
            and no renewal can take one away. */}
        <Card
          title="What your shop runs"
          subtitle="Set for your business by the platform team. Changing plan does not change these."
        >
          {modules.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Nothing switched on yet. Ask support which parts of CartZe suit your business.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {modules.map((m) => (
                <li key={m.key} className="flex gap-2.5">
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" />
                  <span className="min-w-0">
                    <span className="block text-theme-sm font-medium text-gray-800 dark:text-white/90">
                      {m.label}
                    </span>
                    <span className="block text-theme-xs text-gray-500 dark:text-gray-400">
                      {m.description}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Usage">
          {metered.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Nothing on your plan is capped — add as much as you like.
            </p>
          ) : (
            <div className="space-y-4">
              {metered.map((u) => {
                const pct = u.limit && u.limit > 0 ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
                const full = pct >= 100;
                const close = pct >= 80;

                return (
                  <div key={u.key}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-theme-sm">
                      <span className="capitalize text-gray-700 dark:text-gray-300">{u.label}</span>
                      <span className="tabular-nums text-gray-500 dark:text-gray-400">
                        {u.used.toLocaleString()}
                        {" / "}
                        <span className="font-medium text-gray-700 dark:text-gray-300">
                          {u.unlimited ? "∞" : u.limit?.toLocaleString()}
                        </span>
                      </span>
                    </div>
                    {!u.unlimited && (
                      <>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                          <div
                            className={`h-full rounded-full transition-[width] ${
                              full ? "bg-error-500" : close ? "bg-warning-500" : "bg-brand-500"
                            }`}
                            // A width is a number, not a class name — an
                            // interpolated Tailwind class does not exist at
                            // build time and renders as nothing at all.
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {/* Said in words as well as in a bar. A bar at 100%
                            and a bar at 96% look alike, and only one of them
                            means the next product will be refused. */}
                        {full ? (
                          <p className="mt-1 text-theme-xs font-medium text-error-600 dark:text-error-400">
                            Full — ask support to extend this before adding more.
                          </p>
                        ) : close ? (
                          <p className="mt-1 text-theme-xs text-warning-600 dark:text-warning-400">
                            {u.remaining?.toLocaleString()} left.
                          </p>
                        ) : null}
                      </>
                    )}
                    {u.assigned && (
                      <p className="mt-1 text-theme-xs text-gray-400">
                        Extended for your shop beyond the plan's {u.baseline?.toLocaleString()}.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Payments payments={data.payments} />
    </>
  );
}

/**
 * WHERE THIS SHOP STANDS, first and in full.
 *
 * It was a badge in the corner of a card. A read-only shop cannot ring a sale
 * — that is the most consequential sentence the app ever says to an owner, and
 * it needs more than eleven pixels and a colour.
 */
function StandingBanner({ data }: { data: SubscriptionInfo }) {
  if (data.state === "read_only") {
    return (
      <Banner tone="error" title="Your subscription has run out">
        <p>
          The shop is read-only: everything you have is here and nothing has been deleted, but new
          sales, stock changes and expenses are paused until it is renewed.
        </p>
        <p className="mt-1 font-medium">Contact support to renew and it comes straight back on.</p>
      </Banner>
    );
  }

  if (data.state === "grace") {
    return (
      <Banner tone="warning" title="Payment is overdue">
        <p>
          Your shop is working normally through its grace period.
          {data.grace_ends_at && (
            <>
              {" "}Renew before <strong>{day(data.grace_ends_at)}</strong> ({whenPhrase(data.grace_ends_at)}) or
              it becomes read-only — you would still see everything, but not be able to ring a sale.
            </>
          )}
        </p>
        <p className="mt-1">Your data is safe either way.</p>
      </Banner>
    );
  }

  // Active, and close enough to matter. Nothing at all when it is months away:
  // a banner that is always there is a banner nobody reads.
  const days = data.subscription_ends_at === null ? null : daysUntil(data.subscription_ends_at);

  if (days !== null && days <= 14) {
    return (
      <Banner tone="warning" title={`Renews ${whenPhrase(data.subscription_ends_at!)}`}>
        <p>
          Your subscription runs to <strong>{day(data.subscription_ends_at!)}</strong>. Nothing
          changes until then — this is here so it is not a surprise.
        </p>
      </Banner>
    );
  }

  return (
    <Banner tone="success" title="Everything is up to date">
      <p>
        Your shop is active
        {data.subscription_ends_at && <> until <strong>{day(data.subscription_ends_at)}</strong></>}.
      </p>
    </Banner>
  );
}

const TONE = {
  success: "border-success-200 bg-success-50 text-success-800 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300",
  warning: "border-warning-300 bg-warning-25 text-warning-800 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-300",
  error: "border-error-300 bg-error-50 text-error-800 dark:border-error-500/40 dark:bg-error-500/10 dark:text-error-300",
} as const;

const DOT = {
  success: "bg-success-500",
  warning: "bg-warning-500",
  error: "bg-error-500",
} as const;

function Banner({
  tone,
  title,
  children,
}: {
  tone: keyof typeof TONE;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`mb-6 flex gap-3.5 rounded-2xl border p-4 sm:p-5 ${TONE[tone]}`}>
      <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-full ${DOT[tone]}`} />
      <div className="min-w-0 text-theme-sm">
        <p className="mb-1 font-semibold">{title}</p>
        {children}
      </div>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="font-semibold text-gray-800 dark:text-white/90">{title}</h3>
      {subtitle && <p className="mb-4 mt-1 text-theme-xs text-gray-400">{subtitle}</p>}
      <div className={subtitle ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="font-medium text-gray-800 dark:text-white/90">{value}</dd>
    </div>
  );
}

/**
 * WHAT HAS BEEN PAID — a table, because it is a record somebody reconciles.
 *
 * It was a stack of two-line rows that omitted the two things a record is for:
 * the date the money actually arrived, and the reference on the receipt. Both
 * were in the payload and neither was drawn.
 */
function Payments({ payments }: { payments: SubscriptionInfo["payments"] }) {
  if (payments.length === 0) {
    return (
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="font-semibold text-gray-800 dark:text-white/90">Payments</h3>
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          Nothing recorded yet. Payments appear here once the platform team enters them.
        </p>
      </section>
    );
  }

  const exportCsv = () =>
    downloadCsv(
      "cartze-payments.csv",
      ["Paid", "Plan", "Period start", "Period end", "Method", "Reference", "Amount"],
      payments.map((p) => [
        new Date(p.paid_at).toLocaleDateString(),
        p.plan_name,
        p.period_start,
        p.period_end,
        p.method.replace(/_/g, " "),
        p.reference ?? "",
        Number(p.amount),
      ]),
    );

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-white/90">Payments</h3>
          <p className="text-theme-xs text-gray-400">
            {/* The whole list is in the response, so what is on screen IS the
                export — no round trip that could disagree with it. */}
            Your last {payments.length} {payments.length === 1 ? "payment" : "payments"}
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="h-10 rounded-xl border border-gray-200 px-4 text-theme-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/5"
        >
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-100 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
              <th className="px-5 py-3 font-medium">Paid</th>
              <th className="px-5 py-3 font-medium">Plan</th>
              <th className="px-5 py-3 font-medium">Covers</th>
              <th className="px-5 py-3 font-medium">Method</th>
              <th className="px-5 py-3 font-medium">Reference</th>
              <th className="px-5 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {payments.map((p) => (
              <tr key={p.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                <td className="whitespace-nowrap px-5 py-3">{day(p.paid_at)}</td>
                <td className="px-5 py-3 font-medium text-gray-800 dark:text-white/90">{p.plan_name}</td>
                <td className="whitespace-nowrap px-5 py-3 text-theme-xs text-gray-400">
                  {p.period_start} → {p.period_end}
                </td>
                <td className="px-5 py-3">
                  <Badge size="sm" color="light">{p.method.replace(/_/g, " ")}</Badge>
                </td>
                <td className="px-5 py-3 text-theme-xs">{p.reference ?? "—"}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right font-medium tabular-nums">
                  {money(p.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-gray-100 px-5 py-3 text-theme-xs text-gray-400 dark:border-gray-800">
        Something not right? <Link to="/tenant/help" className="text-brand-500 hover:text-brand-600">Ask support</Link> —
        plans and payments are recorded by the platform team, not from this screen.
      </p>
    </section>
  );
}
