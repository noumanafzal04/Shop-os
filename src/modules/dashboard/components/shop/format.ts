const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The payload mixes ISO-8601 timestamps (`sold_at`, `at`) with plain calendar
 * dates (`expense_date`), and either can be null. A date-only string handed to
 * `new Date()` is parsed as UTC midnight, which renders as YESTERDAY for
 * anyone west of Greenwich — so those are rebuilt in local time.
 */
function parse(value: string | null | undefined): Date | null {
  if (!value) return null;

  const parts = DATE_ONLY.exec(value);
  const date = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/** "5 Aug 2026", or an em dash when the field is null/unparseable. */
export function formatDate(value: string | null | undefined): string {
  const date = parse(value);

  return date
    ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "—";
}

/** "5 Aug, 14:32" — the timeline wants the clock, not the year. */
export function formatDateTime(value: string | null | undefined): string {
  const date = parse(value);
  if (!date) return "—";

  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${date.toLocaleTimeString(
    undefined,
    { hour: "2-digit", minute: "2-digit" },
  )}`;
}

/** "+12.4%" / "-8%". Null in, null out — the caller then renders nothing. */
export function formatDelta(delta: number | null | undefined): string | null {
  if (delta === null || delta === undefined) return null;

  const rounded = Math.round(Math.abs(delta) * 10) / 10;

  return `${delta < 0 ? "−" : "+"}${rounded}%`;
}

/** CamelCase audit entity → readable noun ("ProductBatch" → "product batch"). */
export function humanizeEntity(entity: string | undefined): string {
  if (!entity) return "record";

  return entity.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}
