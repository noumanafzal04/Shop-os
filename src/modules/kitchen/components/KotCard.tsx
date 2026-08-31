import type { KotCard as Kot } from "../services/kitchenService";

/**
 * How long a ticket has been up, in words a cook reads at a glance.
 *
 * The thresholds are deliberately tight for food: eight minutes is roughly when
 * a table starts looking around for someone, and fifteen is when they complain.
 * A board that only turns red at half an hour is decoration.
 */
const WARN_SECONDS = 8 * 60;
const LATE_SECONDS = 15 * 60;

type Urgency = "fresh" | "warn" | "late";

export function urgencyOf(ageSeconds: number, status: Kot["status"]): Urgency {
  // Food sitting on the pass is the worst kind of late — it is going cold with
  // nobody carrying it — so a ready ticket ages twice as fast.
  const weighted = status === "ready" ? ageSeconds * 2 : ageSeconds;
  if (weighted >= LATE_SECONDS) return "late";
  if (weighted >= WARN_SECONDS) return "warn";
  return "fresh";
}

export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** The action that moves this ticket along. One per card — never a menu. */
const NEXT: Record<Kot["status"], { label: string; status: "preparing" | "ready" | "served" } | null> = {
  fired: { label: "Start", status: "preparing" },
  preparing: { label: "Ready", status: "ready" },
  ready: { label: "Served", status: "served" },
  served: null,
};

const EDGE: Record<Urgency, string> = {
  fresh: "border-gray-200 dark:border-gray-700",
  warn: "border-warning-400 dark:border-warning-500",
  late: "border-error-500",
};

const AGE_TEXT: Record<Urgency, string> = {
  fresh: "text-gray-500 dark:text-gray-400",
  warn: "text-warning-600 dark:text-warning-400",
  late: "text-error-600 dark:text-error-400",
};

const STATUS_CHIP: Record<Kot["status"], string> = {
  fired: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300",
  preparing: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400",
  ready: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400",
  served: "bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400",
};

interface Props {
  kot: Kot;
  /** Recomputed on the client so the age ticks between polls. */
  ageSeconds: number;
  onBump: (status: "preparing" | "ready" | "served") => void;
  busy?: boolean;
}

export function KotCardTile({ kot, ageSeconds, onBump, busy = false }: Props) {
  const urgency = urgencyOf(ageSeconds, kot.status);
  const next = NEXT[kot.status];

  return (
    <article
      className={`flex flex-col rounded-2xl border-2 bg-white shadow-theme-xs dark:bg-white/[0.04] ${EDGE[urgency]}`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <div className="min-w-0">
          {/* The table is how a cook finds the ticket, so it is the biggest
              thing on the card by a wide margin. */}
          <h3 className="truncate text-2xl font-bold leading-tight text-gray-900 dark:text-white">
            {kot.table_name ?? kot.ticket_number ?? "—"}
          </h3>
          <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
            KOT #{kot.kot_number}
            {kot.station ? ` · ${kot.station}` : ""}
            {kot.guest_count ? ` · ${kot.guest_count} covers` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-xl font-bold tabular-nums ${AGE_TEXT[urgency]}`}>{formatAge(ageSeconds)}</div>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-theme-xs font-semibold uppercase ${STATUS_CHIP[kot.status]}`}>
            {kot.status}
          </span>
        </div>
      </header>

      <ul className="flex-1 space-y-2.5 px-4 py-3">
        {(kot.items ?? []).map((item, i) => (
          <li key={i} className="flex gap-3">
            <span className="min-w-[2.2rem] shrink-0 text-lg font-bold tabular-nums text-gray-900 dark:text-white">
              {item.quantity}
            </span>
            <div className="min-w-0">
              <div className="text-lg font-medium leading-snug text-gray-800 dark:text-gray-100">{item.name}</div>
              {item.modifiers.length > 0 && (
                <div className="text-theme-sm text-gray-500 dark:text-gray-400">
                  {item.modifiers.map((m) => m.name).filter(Boolean).join(" · ")}
                </div>
              )}
              {/* A kitchen note is an instruction, not a footnote — an allergy
                  lives here, so it gets the loudest treatment on the card. */}
              {item.note && (
                <div className="mt-0.5 text-theme-sm font-bold uppercase text-error-600 dark:text-error-400">
                  {item.note}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {kot.notes && (
        <p className="border-t border-gray-100 px-4 py-2 text-theme-sm font-semibold uppercase text-error-600 dark:border-gray-800 dark:text-error-400">
          {kot.notes}
        </p>
      )}

      {next && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onBump(next.status)}
          className="m-3 rounded-xl bg-brand-500 py-3.5 text-lg font-semibold text-white transition hover:bg-brand-600 active:bg-brand-700 disabled:opacity-50"
        >
          {next.label}
        </button>
      )}
    </article>
  );
}
