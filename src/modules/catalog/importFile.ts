import type { Category } from "./types";

/**
 * What an import says back — a preview of it, or the thing itself.
 *
 * The two are one shape on purpose: the preview IS the import, run and undone
 * on the server, so a screen that can draw one can draw the other.
 */
export interface ImportSummary {
  dry_run: boolean;
  kind: "xlsx" | "csv";
  total: number;
  created: number;
  updated: number;
  failed: number;
  skipped: number;
  /** Rows held up by a category the shop does not have. Only in a preview. */
  waiting: number;
  errors: Array<{ row: number; messages: string[] }>;
  /** Rows that were taken, with something worth knowing about them. */
  warnings: Array<{ row: number; messages: string[] }>;
  /** Each row that did not go in, as it was sent — to correct and send again. */
  failed_rows: Array<{ row: number; status: "failed" | "waiting"; messages: string[]; cells: Record<string, string> }>;
  /** The file's own headings, in its own order. */
  headers: string[];
  ignored_columns: Array<{ header: string; reason: string; unknown: boolean }>;
  unknown_categories: Array<{ name: string; rows: number; suggestion: { id: string; path: string } | null }>;
  /** What a heading may be said to be: this shop's columns, field → name on the sheet. */
  fields: Record<string, string>;
  /** New rows with no SKU whose name the shop already has. */
  same_name: number;
}

/** What somebody chose to do about a category their shop does not have. */
export type CategoryChoice =
  | { action: "create" }
  | { action: "map"; id: string }
  | { action: "skip" };

export const PATH_SEPARATOR = " > ";

/** Every category in the shop as the path a sheet writes: "Grocery > Beverages". */
export function categoryPaths(tree: Category[], above = ""): Array<{ id: string; path: string }> {
  return tree.flatMap((c) => {
    const path = above === "" ? c.name : `${above}${PATH_SEPARATOR}${c.name}`;

    return [{ id: c.id, path }, ...categoryPaths(c.children ?? [], path)];
  });
}

/**
 * Where the choices start: a near-miss points at the category it nearly was.
 *
 * Anything else starts with NO choice. Creating a category is never the
 * default — a default is a thing pressed past, and "pressed past" is how a
 * spelling mistake becomes a shelf.
 */
export function startingChoices(unknown: ImportSummary["unknown_categories"]): Record<string, CategoryChoice> {
  const choices: Record<string, CategoryChoice> = {};
  for (const c of unknown) {
    if (c.suggestion) choices[c.name] = { action: "map", id: c.suggestion.id };
  }

  return choices;
}

/** The categories the file names that nobody has said anything about yet. */
export function undecided(unknown: ImportSummary["unknown_categories"], choices: Record<string, CategoryChoice>): string[] {
  return unknown.filter((c) => choices[c.name] === undefined).map((c) => c.name);
}

/** As the server takes them: a list, because a category's name is not a safe form key. */
export function choicesForServer(choices: Record<string, CategoryChoice>): Array<{ name: string; action: string; id?: string }> {
  return Object.entries(choices).map(([name, c]) => ({ name, action: c.action, ...(c.action === "map" ? { id: c.id } : {}) }));
}

/** What Excel looks for at the start of a file to read it as UTF-8. Written as a code, not a character, so it can be seen. */
export const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const cell = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/**
 * The rows that did not go in, as a file to correct and upload again.
 *
 * The file's own columns, in its own order, with two of ours on the end saying
 * what was wrong. The import knows those two and does not read them back, so
 * the corrected file can be sent as it is. Starts with the mark Excel needs to
 * read Urdu and accents correctly.
 */
export function failedRowsCsv(summary: Pick<ImportSummary, "headers" | "failed_rows">): string {
  const lines = [[...summary.headers, "_import_status", "_error_message"].map(cell).join(",")];

  for (const row of summary.failed_rows) {
    lines.push(
      [...summary.headers.map((h) => row.cells[h] ?? ""), row.status, row.messages.join(" ")].map(cell).join(","),
    );
  }

  return `${BYTE_ORDER_MARK}${lines.join("\r\n")}\r\n`;
}

/**
 * The rows worth handing back: the ones with something WRONG in them.
 *
 * A row only waiting on a category has nothing to correct — it is waiting on a
 * choice made on the screen, not in the sheet — and a file of "rows to correct"
 * that listed it would send somebody looking for a fault that is not there.
 */
export function rowsToCorrect<T extends Pick<ImportSummary, "headers" | "failed_rows">>(summary: T): T {
  return { ...summary, failed_rows: summary.failed_rows.filter((r) => r.status === "failed") };
}

/** How many rows will actually be written, as things stand. */
export function goingIn(summary: Pick<ImportSummary, "created" | "updated">): number {
  return summary.created + summary.updated;
}

/**
 * A LONG LIST GOES IN PARTS, BY ITSELF (garments round, #GS1).
 *
 * The server takes up to 500 rows in one request — a check is the import run
 * and undone, and a request has a time limit. A garments shop bringing 20,000
 * items was told "Split it into files of up to 500" and made forty files by
 * hand. A CSV is now cut here, on the device, into parts the server takes, and
 * each part is checked and brought in on its own; the screen shows one answer.
 * (An .xlsx cannot be cut in the browser; a long one is still refused, and the
 * refusal says to save it as CSV.)
 */
export const ROWS_PER_SEND = 500;

/** The records of a CSV — a quoted cell may hold commas and line breaks. */
function csvRecords(text: string): string[] {
  const records: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) {
      if (i > start) records.push(text.slice(start, i));
      if (c === "\r" && text[i + 1] === "\n") i++;
      start = i + 1;
    }
  }
  if (start < text.length && text.slice(start).trim() !== "") records.push(text.slice(start));

  return records.filter((r) => r.trim() !== "");
}

/** The cells of one CSV record — a quoted cell may hold a comma, and "" is a quote. */
function csvCells(record: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < record.length; i++) {
    const c = record[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (record[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      cells.push(cell);
      cell = "";
    } else cell += c;
  }
  cells.push(cell);

  return cells;
}

/**
 * The CSV as parts of at most `perPart` rows, each with the heading row — one
 * part when it fits — and how many rows each part carries, so the screen can
 * count rows going in rather than parts.
 *
 * AN ITEM AND ITS SIZES GO IN ONE PART (#GS7). Each part is checked on its own
 * and the check is undone, so a size cut off from its item into the next part
 * was told "No product in this shop has the SKU" — though the import itself
 * brought it in. A part that would end just before a size (or a pack) ends
 * instead before the item those rows follow, and the next part starts with it.
 */
export function splitCsv(text: string, perPart: number = ROWS_PER_SEND): { parts: string[]; rows: number[] } {
  const clean = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  const [head, ...rows] = csvRecords(clean);
  if (head === undefined || rows.length <= perPart) return { parts: [text], rows: [rows.length] };

  const parentAt = csvCells(head).findIndex((h) => h.toLowerCase().replace(/[^a-z0-9]/g, "") === "parentsku");
  const belongs = (row: string) => parentAt >= 0 && (csvCells(row)[parentAt] ?? "").trim() !== "";

  const parts: string[] = [];
  const counts: number[] = [];
  for (let i = 0; i < rows.length; ) {
    let end = Math.min(i + perPart, rows.length);
    if (end < rows.length && belongs(rows[end])) {
      let item = end - 1;
      while (item > i && belongs(rows[item])) item--;
      // An item with more sizes than a part holds is cut where it must be.
      if (item > i) end = item;
    }
    const slice = rows.slice(i, end);
    parts.push([head, ...slice].join("\n"));
    counts.push(slice.length);
    i = end;
  }

  return { parts, rows: counts };
}

/** What a long import says while it runs: rows, not parts, and a bar's worth of percent. */
export type ImportProgressSaid = {
  doing: "Checking" | "Bringing in";
  /** "12,500 / 50,010 rows · 25%" */
  rows: string;
  percent: number;
  /** "about 4 min left" — null until a part has come back to judge the pace by. */
  left: string | null;
  part: number;
  parts: number;
};

/**
 * A LONG IMPORT, SAID AS IT GOES (2026-11-01). The 50k walk took six minutes
 * behind a grey line in the corner — "Bringing in part 52 of 101". Now: the
 * rows in so far out of the whole file, a percent that never reads 100 before
 * the last part is in, and how long is left at the pace so far.
 */
export function progressSaid(
  p: { doing: ImportProgressSaid["doing"]; done: number; total: number; part: number; parts: number; startedAt: number },
  now: number,
): ImportProgressSaid {
  const percent = p.total > 0 ? Math.min(99, Math.floor((p.done / p.total) * 100)) : 0;
  let left: string | null = null;
  if (p.done > 0 && p.done < p.total) {
    const seconds = Math.round((((now - p.startedAt) / p.done) * (p.total - p.done)) / 1000);
    left = seconds < 60 ? "less than a minute left" : `about ${Math.round(seconds / 60)} min left`;
  }

  return {
    doing: p.doing,
    rows: `${p.done.toLocaleString()} / ${p.total.toLocaleString()} rows · ${percent}%`,
    percent,
    left,
    part: p.part,
    parts: p.parts,
  };
}

/**
 * The answers of every part, as one. Row numbers are moved on by the rows that
 * came before, so "row 12 of part 3" reads as the row it is in the whole file.
 */
export function mergeSummaries(parts: Array<{ summary: ImportSummary; rowsBefore: number }>): ImportSummary {
  const [first] = parts;
  const shift = <T extends { row: number }>(list: T[], by: number): T[] => list.map((r) => ({ ...r, row: r.row + by }));
  const unknown = new Map<string, ImportSummary["unknown_categories"][number]>();
  for (const { summary } of parts) {
    for (const c of summary.unknown_categories) {
      const had = unknown.get(c.name);
      unknown.set(c.name, had ? { ...had, rows: had.rows + c.rows, suggestion: had.suggestion ?? c.suggestion } : { ...c });
    }
  }
  const add = (key: "total" | "created" | "updated" | "failed" | "skipped" | "waiting" | "same_name") =>
    parts.reduce((n, p) => n + (p.summary[key] ?? 0), 0);

  return {
    ...first.summary,
    total: add("total"),
    created: add("created"),
    updated: add("updated"),
    failed: add("failed"),
    skipped: add("skipped"),
    waiting: add("waiting"),
    same_name: add("same_name"),
    errors: parts.flatMap((p) => shift(p.summary.errors, p.rowsBefore)),
    warnings: parts.flatMap((p) => shift(p.summary.warnings, p.rowsBefore)),
    failed_rows: parts.flatMap((p) => shift(p.summary.failed_rows, p.rowsBefore)),
    unknown_categories: [...unknown.values()],
  };
}
