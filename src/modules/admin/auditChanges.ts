/**
 * One audit row's changes, as lines a person can read.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 *
 * The trail printed every value with `JSON.stringify`. For a price that is
 * fine. For a shop's module map it printed the whole map, twice:
 *
 *     features: {"hrm":true,"pos":true,"fuel":true,… → {"hrm":true,"pos":true,…
 *
 * twenty-one keys on each side of an arrow, to say that ONE of them moved. An
 * admin reading "what did I change on this shop" had to diff two JSON blobs
 * by eye. So a value that is itself a set of named things is opened up, and
 * only the names that actually differ are shown.
 */

export interface ChangeLine {
  /** What moved, named the way the screens name it where a name is known. */
  field: string;
  /** Absent for a create or a delete, where there is one value and no arrow. */
  from?: string;
  to: string;
}

type Values = Record<string, unknown> | null | undefined;

const HIDDEN = new Set(["id", "created_by", "updated_by"]);

const isMap = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** One value, short. A switch reads as a switch. */
export function show(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (v === true) return "on";
  if (v === false) return "off";
  if (isMap(v)) {
    const values = Object.values(v);
    // A map of switches is summed up, not spelled out.
    if (values.length > 0 && values.every((x) => typeof x === "boolean")) {
      return `${values.filter(Boolean).length} on, ${values.filter((x) => !x).length} off`;
    }

    return `${values.length} fields`;
  }
  if (typeof v === "object") return JSON.stringify(v);

  return String(v);
}

/**
 * A map that was filed as its own JSON text.
 *
 * Years of rows hold a changed JSON column as a quoted string on the "after"
 * side and a real map on the "before" side — the trail wrote one from the raw
 * column and the other from the cast model. New rows are maps on both sides;
 * the old ones are read as what they were always meant to be.
 */
const opened = (v: unknown): unknown => {
  if (typeof v !== "string" || !v.trimStart().startsWith("{")) return v;
  try {
    const parsed: unknown = JSON.parse(v);

    return isMap(parsed) ? parsed : v;
  } catch {
    return v;
  }
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * @param labels  names for the keys INSIDE a map — the module catalogue, so
 *                `promotions` reads "Coupons & Promotions". A key with no
 *                label is shown as itself rather than dropped.
 */
export function changeLines(
  event: "created" | "updated" | "deleted",
  oldValues: Values,
  newValues: Values,
  labels: Record<string, string> = {},
): ChangeLine[] {
  const keys = Array.from(new Set([...Object.keys(newValues ?? {}), ...Object.keys(oldValues ?? {})])).filter(
    (k) => !HIDDEN.has(k),
  );

  const lines: ChangeLine[] = [];
  for (const key of keys) {
    const before = opened(oldValues?.[key]);
    const after = opened(newValues?.[key]);

    if (event !== "updated") {
      lines.push({ field: key, to: show(opened((newValues ?? oldValues)?.[key])) });
      continue;
    }

    // A set of named things: say which names moved.
    if (isMap(before) && isMap(after)) {
      const inner = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
      const moved = inner.filter((k) => !same(before[k], after[k]));
      for (const k of moved) {
        lines.push({ field: labels[k] ?? k, from: show(before[k]), to: show(after[k]) });
      }
      // Recorded as changed, and nothing inside it differs: say so, rather
      // than leaving a row with no explanation of why it exists.
      if (moved.length === 0) lines.push({ field: key, from: show(before), to: show(after) });
      continue;
    }

    lines.push({ field: key, from: show(before), to: show(after) });
  }

  return lines;
}

/** What each platform setting is called on the screens that set it. */
const SETTING: Record<string, string> = {
  module_addon_prices: "Add-on price",
  commission_enabled: "Commission",
  commission_rate: "Commission rate",
  commission_base: "Commission is charged on",
  console_theme_primary: "Console colour",
  console_theme_tint: "Console tint",
  console_theme_sidebar: "Console menu",
};

const rupees = (v: unknown): string => (typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) ? `Rs ${Number(v).toLocaleString()}` : "free");

/** One setting's value, in the words of the screen it is set on. */
function said(key: string, v: unknown): string {
  if (v === null || v === undefined) return key === "console_theme_primary" ? "the house colour" : "∅";
  if (key === "commission_rate") return `${Number(v)}%`;
  if (key === "commission_base") return v === "total" ? "the whole order" : v === "goods" ? "the goods only" : String(v);

  return show(v);
}

/**
 * A PLATFORM SETTING'S ROW, in the words of the screen that set it.
 *
 * The trail did not hold these at all until a price list was emptied and
 * nobody could say by whom. Filed like any other row they would read
 * "PlatformSetting — value: 2 fields → 1 fields": true, and useless. A
 * setting is named by its key (the row's own id), and the one that is a list
 * of prices is opened up the way a module map is —
 *
 *     Add-on price · Bank Card Offers:  free → Rs 350
 *     Add-on price · Products:          Rs 25,000 → free
 *
 * which is the line that would have answered the question.
 *
 * @param labels  the module catalogue, for the names inside the price list
 */
export function settingLines(
  key: string,
  event: "created" | "updated" | "deleted",
  oldValues: Values,
  newValues: Values,
  labels: Record<string, string> = {},
): ChangeLine[] {
  const name = SETTING[key] ?? key;
  const before = opened(oldValues?.value);
  const after = opened(newValues?.value);

  if (key === "module_addon_prices") {
    // Never priced, and taken off the list, are both "free": an absent key.
    const was = event === "created" || !isMap(before) ? {} : before;
    const now = event === "deleted" || !isMap(after) ? {} : after;
    const moved = Array.from(new Set([...Object.keys(was), ...Object.keys(now)])).filter((k) => !same(was[k], now[k]));

    return moved.map((k) => ({ field: `${name} · ${labels[k] ?? k}`, from: rupees(was[k]), to: rupees(now[k]) }));
  }

  // Handed back to what it is when nobody has chosen.
  if (event === "deleted") return [{ field: name, from: said(key, before), to: "back to the default" }];
  if (event === "created") return [{ field: name, to: said(key, after) }];

  return [{ field: name, from: said(key, before), to: said(key, after) }];
}

