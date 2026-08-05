/**
 * Platform-console formatting.
 *
 * Money here is always rupees: `currency_symbol` is a per-tenant shop setting
 * and means nothing on a cross-tenant screen. A payment row that carries a
 * different currency code prints that code rather than a wrong symbol.
 */

export function money(amount: number, currency?: string | null): string {
  const code = currency?.trim().toUpperCase();
  const prefix = !code || code === "PKR" ? "Rs" : code;

  return `${prefix} ${amount.toLocaleString(undefined, {
    // Whole rupees decode as ints; only show paisa when there are any.
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function count(n: number): string {
  return n.toLocaleString();
}

/** Axis labels only — a "1.2M" tick is legible where the full figure is not. */
export function compact(n: number): string {
  return n.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });
}

/** Signed, so the pill reads "+12.4%" / "-3%" without extra plumbing. */
export function signedPct(pct: number): string {
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);

  return Number.isNaN(d.getTime()) ? null : d;
}

export function date(iso: string | null | undefined): string {
  const d = parse(iso);

  return d
    ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "—";
}

export function dateTime(iso: string | null | undefined): string {
  const d = parse(iso);

  return d
    ? d.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
}

/** Machine tokens ("business_type", "created") into prose. */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  const words = value.replace(/[_-]+/g, " ").trim();

  return words.charAt(0).toUpperCase() + words.slice(1);
}
