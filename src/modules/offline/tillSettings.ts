import { useEffect, useState } from "react";

import { getSingleton } from "./db/repo";
import { STORE } from "./db/schema";

/**
 * The shop's own settings, as the till last received them.
 *
 * ── Why a screen would want these instead of the server's answer ────────
 *
 * The drawer-close screen asks the server how this shop counts out: by note or
 * by total, blind or not, and whether the card and bank takings must be
 * declared. With no server that request fails and the screen fell back to
 * hardcoded defaults — so a shop that counts by note got a different close
 * during an outage, and a shop that must declare its tenders **was never
 * asked**, losing that shift's declaration entirely.
 *
 * The answers were already on the device: they ride down with the catalog,
 * which is the one call a till makes while it still has a connection. Nothing
 * read them.
 *
 * ── Undefined means "not known yet", not "off" ──────────────────────────
 *
 * The hook starts undefined and stays undefined on a till that has never
 * pulled. Callers must fall back to their own defaults rather than treating it
 * as false: a missing answer is not a shop that turned something off.
 */
export type TillSettings = Record<string, unknown> | undefined;

export async function readTillSettings(): Promise<TillSettings> {
  try {
    return await getSingleton<Record<string, unknown>>(STORE.SETTINGS);
  } catch {
    // A till that cannot read its own cache must still be able to close a
    // drawer. The caller's defaults are a worse answer than the shop's, and a
    // far better one than a screen that will not open.
    return undefined;
  }
}

export function useTillSettings(enabled: boolean = true): TillSettings {
  const [settings, setSettings] = useState<TillSettings>(undefined);

  useEffect(() => {
    if (!enabled) return;

    let alive = true;
    void readTillSettings().then((s) => {
      if (alive) setSettings(s);
    });

    return () => {
      alive = false;
    };
  }, [enabled]);

  return settings;
}

/** A stored setting read as a boolean, with the caller's default when unknown. */
export function tillFlag(settings: TillSettings, key: string, fallback: boolean): boolean {
  const value = settings?.[key];

  return typeof value === "boolean" ? value : value === undefined ? fallback : Boolean(value);
}
