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
