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
