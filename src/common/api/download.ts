import { api } from "./client";

/**
 * Download a file from an authenticated endpoint. A plain <a href> can't carry
 * the bearer token, so we pull the bytes through the axios instance (which
 * attaches auth) and hand the browser a blob URL. The filename is taken from
 * the server's Content-Disposition, falling back to a sensible default.
 */
export async function downloadFile(
  url: string,
  params?: Record<string, unknown>,
  fallbackName = "export.csv",
): Promise<void> {
  const res = await api.get(url, { responseType: "blob", params });

  const disposition = (res.headers["content-disposition"] as string | undefined) ?? "";
  const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^;"']+)/i);
  const filename = match ? decodeURIComponent(match[1].trim()) : fallbackName;

  saveBlob(res.data as Blob, filename);
}

/**
 * Open a file from an authenticated endpoint in a new tab.
 *
 * Receipts used to be plain `<a href>` links to public storage — which is why
 * they were readable by anyone the URL reached. Now the bytes come through the
 * axios instance (which carries the bearer token) and the browser is handed a
 * blob URL, so the file is only ever seen by someone the API would answer.
 *
 * The blob URL is revoked on a timer rather than immediately: revoking it in
 * the same tick closes the tab that was just opened with it.
 */
export async function openAuthedFile(url: string): Promise<void> {
  const res = await api.get(url, { responseType: "blob" });

  const blobUrl = URL.createObjectURL(res.data as Blob);
  window.open(blobUrl, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

/**
 * A CSV built from rows the browser already has.
 *
 * Most exports here stream from the server, because the screen only holds one
 * page and an export of page one is not an export. Where the endpoint returns
 * the WHOLE set in one response — budgets do — the rows on screen are the rows
 * in the file, and a round trip would only risk the two disagreeing.
 */
export function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null>>): void {
  // Anything carrying a comma, a quote or a newline has to be quoted, and a
  // quote inside is doubled. A field starting =, +, - or @ is prefixed with a
  // quote so a spreadsheet reads it as text rather than a formula.
  const cell = (value: string | number | null): string => {
    const text = value === null ? "" : String(value);
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;

    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };

  const csv = [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");

  // The BOM is what makes Excel read UTF-8 — without it an Urdu category name
  // arrives as mojibake in the one program most of these files are opened in.
  saveBlob(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }), filename);
}

function saveBlob(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}
