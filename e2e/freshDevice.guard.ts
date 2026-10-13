import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { asAFirstVisit } from "./freshDevice";

/**
 * A SAVED SIGN-IN CARRIES NOTHING THE DEVICE KEPT.
 *
 * The reason is in `freshDevice.ts`. Two things are held here: that the
 * helper takes out what it should and nothing else, and that every spec that
 * saves a sign-in goes through it — the eight that did were each one line
 * that could be written the old way again.
 */

const E2E = path.dirname(fileURLToPath(import.meta.url));

/** Every spec and helper under e2e/, by path. Scratch files (a leading dot) are nobody's standing work. */
function sources(dir: string = E2E): Record<string, string> {
  return Object.fromEntries(fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry): Array<[string, string]> => {
    if (entry.name.startsWith(".")) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return Object.entries(sources(full));

    return entry.name.endsWith(".ts") ? [[path.relative(E2E, full), fs.readFileSync(full, "utf8")]] : [];
  }));
}

const SPECS = sources();

const entry = (name: string, value: unknown) => ({ name, value: typeof value === "string" ? value : JSON.stringify(value) });
const saved = (...localStorage: Array<{ name: string; value: string }>) => ({
  cookies: [{ name: "a-cookie" }],
  origins: [{ origin: "http://localhost:5177", localStorage }],
});
const stored = (state: ReturnType<typeof asAFirstVisit>, name: string) => state.origins[0].localStorage.find((e) => e.name === name)?.value;

describe("what a saved sign-in holds", () => {
  it("drops the answers the shell keeps, the count beside Orders, and the remembered date format", () => {
    const first = asAFirstVisit(saved(
      entry("shopos-kept", { state: { record: { owner: "t1:u1", held: { "shop-settings": { data: {}, at: 1 } } } } }),
      entry("shopos-orders-waiting", { state: { kept: { owner: "t1:u1" } } }),
      entry("shopos-dates", "dmy_text"),
      entry("shopos-auth", { state: { accessToken: "token" } }),
    ));

    expect(stored(first, "shopos-kept")).toBeUndefined();
    expect(stored(first, "shopos-orders-waiting")).toBeUndefined();
    expect(stored(first, "shopos-dates"), "a remembered date format is why a sheet opened in the first second was thrown away").toBeUndefined();
    expect(stored(first, "shopos-auth")).toBeDefined();
  });

  it("keeps the session — who is signed in, and their tokens", () => {
    const first = asAFirstVisit(saved(entry("shopos-auth", {
      state: { user: { id: "u1" }, accessToken: "access", refreshToken: "refresh", isAuthenticated: true, userAt: 1_800_000_000_000, userUnder: "aaaa" },
      version: 0,
    })));

    const auth = JSON.parse(stored(first, "shopos-auth") ?? "{}") as { state: Record<string, unknown>; version: number };
    expect(auth.state.user).toEqual({ id: "u1" });
    expect(auth.state.accessToken).toBe("access");
    expect(auth.state.refreshToken).toBe("refresh");
    expect(auth.state.isAuthenticated).toBe(true);
    expect(auth.version).toBe(0);
  });

  it("…without its claim to be a fresh description of that person", () => {
    // With it, a test in the suite's first five minutes would not ask who it
    // is — and would not notice a module the spec before it switched off.
    const first = asAFirstVisit(saved(entry("shopos-auth", { state: { user: { id: "u1" }, userAt: 1_800_000_000_000, userUnder: "aaaa" } })));

    const auth = JSON.parse(stored(first, "shopos-auth") ?? "{}") as { state: Record<string, unknown> };
    expect(auth.state.userAt).toBeNull();
    expect(auth.state.userUnder).toBeNull();
  });

  it("leaves everything else on the device alone — a lane, a theme, a device id", () => {
    const first = asAFirstVisit(saved(
      entry("shopos-terminal", { state: { activeRegisterId: "r1" } }),
      entry("shopos-device-id", "d534e746-41f7-4d54-b9a0-99f357ebd2ff"),
      entry("ui_mode", "advanced"),
    ));

    expect(first.origins[0].localStorage.map((e) => e.name)).toEqual(["shopos-terminal", "shopos-device-id", "ui_mode"]);
    expect(first.cookies).toEqual([{ name: "a-cookie" }]);
  });

  it("does not choke on a session it cannot read", () => {
    const first = asAFirstVisit(saved(entry("shopos-auth", "not json")));

    expect(stored(first, "shopos-auth")).toBe("not json");
  });
});

describe("every spec that saves a sign-in", () => {
  it("goes through keepSession — none writes the storage state to a file itself", () => {
    const direct = Object.entries(SPECS)
      .filter(([file]) => file !== "freshDevice.ts" && !file.endsWith(".guard.ts"))
      .filter(([, source]) => /storageState\(\s*\{\s*path\b/.test(source))
      .map(([file]) => file);

    expect(direct, "these save a sign-in with everything the device kept — use keepSession(context, path)").toEqual([]);
  });

  it("and the check can see the specs it is checking", () => {
    // A glob that matched nothing would pass the case above for ever.
    expect(Object.keys(SPECS).length).toBeGreaterThan(80);
    expect(Object.keys(SPECS)).toContain("auth.setup.ts");
    expect(Object.keys(SPECS)).toContain(path.join("journey", "kit.ts"));
    expect(Object.entries(SPECS).filter(([, source]) => source.includes("keepSession(")).length).toBeGreaterThanOrEqual(8);
  });
});
