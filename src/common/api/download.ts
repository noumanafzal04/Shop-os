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

  const blobUrl = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}
