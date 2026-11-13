import NetInfo from "@react-native-community/netinfo";
import { create } from "zustand";
import { configureApi } from "./api/client";
import { API_TARGET, LAN_PORT } from "./config";
import { prefs } from "./utils/prefs";

/**
 * A PHONE TEST BUILD FINDS ITS SERVER — on whatever Wi-Fi it is on.
 *
 * Only when `API_TARGET` is `"lan"`. A test build used to carry the
 * computer's address written into it, so the day the router handed the
 * computer a new one — another Wi-Fi, a restart — the app on the phone talked
 * to nobody and had to be rebuilt.
 *
 * Now nothing is written in: at launch the app tries the address it last
 * found; failing that it asks every address on the phone's own Wi-Fi for the
 * server's `/health` (one network is 254 addresses, forty at a time, so a few
 * seconds); failing that it asks the person, and `backend/scripts/serve-lan.sh`
 * has printed the address for them to type.
 */
export const LAN_MODE = API_TARGET === "lan";

const PROBE_MS = 1500;
const BATCH = 40;

/**
 * "192.168.1.5", "192.168.1.5:8002" or "http://192.168.1.5:8002/" → the API
 * root on it. Null for anything that is not an address — the field is typed
 * by hand on a phone keyboard.
 */
export function apiUrlFor(typed: string): string | null {
  const bare = typed.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const m = bare.match(/^([a-z0-9.-]+)(?::(\d{1,5}))?$/i);
  if (m === null || !m[1].includes(".")) return null;
  const port = m[2] !== undefined ? Number(m[2]) : LAN_PORT;
  if (port < 1 || port > 65535) return null;

  return `http://${m[1].toLowerCase()}:${port}/api/v1`;
}

/** The "host:port" part of an API root, for showing and remembering. */
export function hostOf(apiUrl: string): string {
  return apiUrl.replace(/^https?:\/\//, "").replace(/\/api\/v1$/, "");
}

/**
 * Every other address on the phone's own network, nearest first.
 *
 * A home router's /24 — the phone at .37 is told about .36 and .38 before .200,
 * because routers hand out addresses in order and the computer joined the
 * network around the same time the phone did more often than not.
 */
export function neighbours(phoneIp: string): string[] {
  const m = phoneIp.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m === null) return [];
  const prefix = `${m[1]}.${m[2]}.${m[3]}.`;
  const own = Number(m[4]);

  return Array.from({ length: 254 }, (_, i) => i + 1)
    .filter((n) => n !== own)
    .sort((a, b) => Math.abs(a - own) - Math.abs(b - own) || a - b)
    .map((n) => `${prefix}${n}`);
}

/**
 * Is THIS our server? A 200 is not enough — a router's admin page answers on
 * every port it likes. Our `/health` says `success` and names the app.
 */
export async function answers(apiUrl: string, timeoutMs = PROBE_MS): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiUrl}/health`, { signal: abort.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: boolean; data?: { app?: string } };

    return body?.success === true && typeof body?.data?.app === "string";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** The first neighbour that answers, forty asked at a time; null when none does. */
export async function scan(phoneIp: string, ask: (apiUrl: string) => Promise<boolean> = answers): Promise<string | null> {
  const hosts = neighbours(phoneIp);
  for (let i = 0; i < hosts.length; i += BATCH) {
    const batch = hosts.slice(i, i + BATCH).map((h) => apiUrlFor(h)!);
    const found = await Promise.all(batch.map(async (url) => ((await ask(url)) ? url : null)));
    const hit = found.find((u) => u !== null);
    if (hit) return hit;
  }

  return null;
}

/** Use it from now on, and remember it for the next launch. */
async function adopt(apiUrl: string): Promise<void> {
  configureApi({ baseUrl: apiUrl });
  useTestServer.setState({ state: "connected", host: hostOf(apiUrl) });
  await prefs.setTestServer(hostOf(apiUrl));
}

type State = "checking" | "searching" | "connected" | "missing";

export const useTestServer = create<{ state: State; host: string | null }>(() => ({
  state: LAN_MODE ? "checking" : "connected",
  host: null,
}));

/**
 * At launch: the remembered address, else a search of this Wi-Fi. Resolves
 * true when the app may start; false leaves the screen asking for it.
 */
export async function connectTestServer(): Promise<boolean> {
  if (!LAN_MODE) return true;

  const saved = (await prefs.all()).testServer;
  const remembered = saved ? apiUrlFor(saved) : null;
  if (remembered && (await answers(remembered))) {
    await adopt(remembered);
    return true;
  }

  return searchTestServer();
}

/** Search the phone's Wi-Fi — at launch, and from "Search again". */
export async function searchTestServer(): Promise<boolean> {
  useTestServer.setState({ state: "searching" });
  const net = await NetInfo.fetch().catch(() => null);
  const phoneIp = (net?.details as { ipAddress?: string } | null | undefined)?.ipAddress;
  const found = phoneIp ? await scan(phoneIp) : null;
  if (found) {
    await adopt(found);
    return true;
  }
  useTestServer.setState({ state: "missing" });

  return false;
}

/** What the person typed. False (and nothing saved) when nothing answers there. */
export async function connectTypedServer(typed: string): Promise<boolean> {
  const url = apiUrlFor(typed);
  if (url === null || !(await answers(url, 4000))) return false;
  await adopt(url);

  return true;
}

/** "Test server" in the side menu — the Wi-Fi changed, find it again. */
export function changeTestServer(): void {
  useTestServer.setState({ state: "missing" });
}
