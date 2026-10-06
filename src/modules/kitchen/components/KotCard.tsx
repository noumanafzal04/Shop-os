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

export type Urgency = "fresh" | "warn" | "late";

export function urgencyOf(ageSeconds: number, status: Kot["status"]): Urgency {
  // Out is out. A served ticket is a record, and a record does not go red.
  if (status === "served") return "fresh";
  // Food sitting on the pass is the worst kind of late — it is going cold with
  // nobody carrying it — so a ready ticket ages twice as fast.
  const weighted = status === "ready" ? ageSeconds * 2 : ageSeconds;
  if (weighted >= LATE_SECONDS) return "late";
  if (weighted >= WARN_SECONDS) return "warn";
  return "fresh";
}

/**
 * "4m 05s", "2h 10m" — and "3d 4h" for something an earlier service left.
 *
 * The last form is new. A ticket from last week read "171h 22m", which is a
 * number nobody turns back into "Tuesday"; days are what make it obvious the
 * card is not tonight's.
 */
export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * The action that moves this ticket along. One per card — never a menu.
 *
 * Each has its own colour, and it is the colour of where the ticket is GOING:
 * the lane it will land in. A cook with wet hands finds "the green one"
 * faster than they read a word.
 */
const NEXT: Record<Kot["status"], { label: string; status: "preparing" | "ready" | "served"; cls: string } | null> = {
  fired: {
    label: "Start cooking",
    status: "preparing",
    cls: "bg-warning-500 text-gray-900 hover:bg-warning-400 active:bg-warning-600",
  },
  preparing: {
    label: "Ready",
    status: "ready",
    cls: "bg-success-600 text-white hover:bg-success-500 active:bg-success-700",
  },
  ready: {
    label: "Served",
    status: "served",
    cls: "bg-gray-900 text-white hover:bg-gray-800 active:bg-black dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200",
  },
  served: null,
};

/** The frame says how late; the lane already says which stage. */
const FRAME: Record<Urgency, string> = {
  fresh: "border-gray-200 dark:border-gray-800",
  warn: "border-warning-400 dark:border-warning-500/70",
  late: "border-error-500 dark:border-error-500",
};

const HEAD: Record<Urgency, string> = {
  fresh: "bg-white dark:bg-transparent",
  warn: "bg-warning-50 dark:bg-warning-500/10",
  late: "bg-error-50 dark:bg-error-500/10",
};

const CLOCK: Record<Urgency, string> = {
  fresh: "text-gray-700 dark:text-gray-200",
  warn: "text-warning-700 dark:text-warning-400",
  late: "text-error-600 dark:text-error-400",
};

/**
 * Said only when there is something to say. Every card on a calm board read
 * "waiting", which is what a ticket on a kitchen board is — the word earned
 * nothing until it changed.
 */
const WAIT_WORD: Record<Urgency, string | null> = {
  fresh: null,
  warn: "getting late",
  late: "late",
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
  const takeaway = kot.order_type === "takeaway";
  // WHAT IS CALLED OUT WHEN IT IS READY.
  //
  // A table's name for a table; a takeaway's own name when it was given one.
  // A walk-up who gave none used to get the word "Takeaway" — on every such
  // card, so a café's pass was a row of identical headings — and the receipt
  // number in the customer's hand, which is the one thing that tells two of
  // them apart, was not on the card at all. It is the heading now.
  const unnamedTakeaway = takeaway && !kot.customer_name;
  const heading = unnamedTakeaway
    ? kot.ticket_number ?? "Takeaway"
    : kot.table_name ?? kot.ticket_number ?? "—";

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-2xl border-2 bg-white dark:bg-gray-900 ${FRAME[urgency]}`}
    >
      <header className={`flex items-start justify-between gap-3 px-4 pb-3 pt-3.5 ${HEAD[urgency]}`}>
        <div className="min-w-0">
          {/* The table is how a cook finds the ticket, so it is the biggest
              thing on the card by a wide margin. */}
          <h3 className="truncate text-2xl font-bold leading-tight text-gray-900 dark:text-white">
            {heading}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-theme-xs text-gray-500 dark:text-gray-400">
            {/* The headline is a NAME on a takeaway card, so the card has to
                say what kind of order it is somewhere — a cook plating a
                dine-in dish and a cook bagging a takeaway are doing two
                different jobs. Said as a mark, not left in a run of text. */}
            <span
              className={`rounded-md px-1.5 py-0.5 font-semibold ${
                takeaway
                  ? "bg-theme-purple-500/10 text-theme-purple-500"
                  : "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"
              }`}
            >
              {takeaway ? "Takeaway" : "Dine-in"}
            </span>
            {/* Spaced, not dotted: a separator that wraps starts the next
                line with a dot belonging to nothing. */}
            {/* A NAMED takeaway still carries its number — the counter
                matches the bag to the receipt, not to "Ahmed". */}
            {takeaway && !unnamedTakeaway && kot.ticket_number ? (
              <span className="font-medium text-gray-700 dark:text-gray-300">{kot.ticket_number}</span>
            ) : null}
            <span>KOT #{kot.kot_number}</span>
            {kot.station ? <span className="font-medium text-gray-700 dark:text-gray-300">{kot.station}</span> : null}
            {kot.guest_count ? <span>{kot.guest_count} covers</span> : null}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-2xl font-bold leading-tight tabular-nums ${CLOCK[urgency]}`}>{formatAge(ageSeconds)}</div>
          {WAIT_WORD[urgency] !== null && (
            <div className={`mt-1 text-[11px] font-bold uppercase tracking-wide ${CLOCK[urgency]}`}>
              {WAIT_WORD[urgency]}
            </div>
          )}
        </div>
      </header>

      <ul className="flex-1 space-y-2.5 border-t border-gray-100 px-4 py-3 dark:border-gray-800">
        {(kot.items ?? []).map((item, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 px-1.5 text-lg font-bold tabular-nums text-gray-900 dark:bg-white/10 dark:text-white">
              {item.quantity}
            </span>
            <div className="min-w-0 pt-0.5">
              <div className="text-lg font-semibold leading-snug text-gray-900 dark:text-gray-100">{item.name}</div>
              {item.modifiers.length > 0 && (
                <div className="text-theme-sm text-gray-500 dark:text-gray-400">
                  {item.modifiers.map((m) => m.name).filter(Boolean).join(" · ")}
                </div>
              )}
              {/* A kitchen note is an instruction, not a footnote — an allergy
                  lives here, so it gets the loudest treatment on the card. */}
              {item.note && (
                <div className="mt-1 inline-block rounded-md bg-error-50 px-2 py-0.5 text-theme-sm font-bold uppercase text-error-600 dark:bg-error-500/15 dark:text-error-400">
                  {item.note}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {kot.notes && (
        <p className="border-t border-error-100 bg-error-50 px-4 py-2 text-theme-sm font-bold uppercase text-error-600 dark:border-error-500/20 dark:bg-error-500/10 dark:text-error-400">
          {kot.notes}
        </p>
      )}

      {next && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onBump(next.status)}
          className={`m-3 mt-0 rounded-xl py-3.5 text-lg font-bold transition disabled:opacity-50 ${next.cls}`}
        >
          {next.label}
        </button>
      )}
    </article>
  );
}
