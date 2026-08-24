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
/**
 * How long the saved sign-in is worth anything.
 *
 * `IssueTokensAction::ACCESS_TTL_MINUTES` is 60, set PER TOKEN at creation —
 * `config/sanctum.php` says `expiration => null`, so reading that file tells you
 * nothing. A full suite runs in about thirteen minutes and is nowhere near it;
 * a suite competing with a backend run on the same machine took over an hour,
 * crossed the line, and every spec after that point was SIGNED OUT.
 *
 * What that looked like was not "session expired". It was "no product cards on
 * screen", "the till listed no sellable products", and an accessibility ratchet
 * reporting `2/5 unnamed` on EVERY screen — the same two controls everywhere,
 * because every screen was the signed-out shell. Thirteen failures that said
 * nothing about the product.
 *
 * So the age is checked, once, and said out loud. A run that cannot be trusted
 * must not read like one that can.
 */
const SESSION_GOOD_FOR_MS = 55 * 60 * 1000;

export function ownerAuth(): Record<string, string> {
  const age = Date.now() - fs.statSync(STATE).mtimeMs;
  if (age > SESSION_GOOD_FOR_MS) {
    throw new Error(
      `the saved sign-in is ${Math.round(age / 60000)} minutes old and access tokens live 60 — `
      + "every assertion after this point is about a signed-out app, not about the product. "
      + "Re-run the suite (auth.setup mints a fresh one).",
    );
  }

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
