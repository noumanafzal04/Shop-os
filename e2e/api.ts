import fs from "node:fs";

export const API = process.env.E2E_API_URL ?? "http://localhost:8000/api/v1";
const STATE = "e2e/.auth/owner.json";

/**
 * The signed-in owner's bearer token, read out of the saved browser session.
 *
 * The specs drive the UI; this is only ever used to ASK THE SERVER WHAT
 * HAPPENED. A till that shows "Sale complete" has told you what the browser
 * believes, which is exactly the envelope this codebase keeps being fooled by —
 * the sale is real when the server has it.
 */
export function ownerAuth(): Record<string, string> {
  const raw = JSON.parse(fs.readFileSync(STATE, "utf8")) as {
    origins: Array<{ localStorage: Array<{ name: string; value: string }> }>;
  };
  const stored = raw.origins
    .flatMap((o) => o.localStorage)
    .find((kv) => kv.name === "shopos-auth")?.value;

  if (!stored) throw new Error("no saved session — auth.setup.ts did not run");

  const token = (JSON.parse(stored) as { state: { accessToken?: string } }).state.accessToken;
  if (!token) throw new Error("the saved session carries no token");

  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

/**
 * Remove every product whose name starts with `prefix`, and answer how many.
 *
 * Because two specs bred. Both named their fixture `…${Date.now()}`, so each
 * run left one more behind permanently: nine shirts and four pizzas, each with
 * its own sizes, all of them SIZED items sitting on the front page of the till.
 *
 * Nothing noticed until a sibling spec starved — `chrome.spec` needs eight
 * PLAIN products to fill a cart with, the sized fixtures had crowded them off
 * page one, and four viewports failed on a precondition about a screen that was
 * working perfectly. A fixture that accumulates is a slow leak that presents as
 * an unrelated bug.
 *
 * So a fixture with a fixed name clears its own ground first. One of a thing,
 * every run, whatever happened last time.
 */
export async function removeProductsNamed(
  request: { get: APIGet; delete: APIDelete },
  prefix: string,
): Promise<number> {
  const auth = ownerAuth();
  const res = await request.get(`${API}/products?search=${encodeURIComponent(prefix)}&per_page=100`, {
    headers: auth,
  });
  if (!res.ok()) return 0;

  const rows = ((await res.json()) as { data: Array<{ id: string; name: string }> }).data ?? [];
  const doomed = rows.filter((r) => r.name.startsWith(prefix));

  for (const row of doomed) {
    await request.delete(`${API}/products/${row.id}`, { headers: auth });
  }

  return doomed.length;
}

type APIGet = (url: string, opts: { headers: Record<string, string> }) => Promise<{
  ok: () => boolean;
  json: () => Promise<unknown>;
}>;
type APIDelete = (url: string, opts: { headers: Record<string, string> }) => Promise<unknown>;
