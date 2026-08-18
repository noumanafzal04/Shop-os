import { create } from "zustand";

import { hoursSinceContact } from "./contact";
import type { StorageHealth } from "./storage/persist";

/**
 * What this till knows about its own offline standing.
 *
 * Deliberately NOT persisted. Every field here is either answered by the server
 * on boot (the policy, when it was last seen) or measured fresh (storage
 * health, pending count). A persisted copy would survive into a session where
 * it is no longer true, and the one thing this store must never do is tell a
 * cashier their sales are safe on the strength of yesterday's answer.
 *
 * The device ID is the exception and lives in localStorage — see deviceId.ts.
 * It is an identity, not a status.
 */

/** How the till is standing right now, in the order it degrades. */
export type OfflineStanding =
  /** In contact with the server. Everything normal. */
  | "green"
  /** Out of contact, but well inside the shop's window. */
  | "amber"
  /** Past the window. Selling continues; somebody senior has to acknowledge it. */
  | "red"
  /** Not yet known — the first boot has not answered. */
  | "unknown";

/** Fraction of the window past which the shop starts being warned. */
export const AMBER_AT = 0.75;

interface OfflineState {
  /** This browser's stable id, once the boot has read it. */
  deviceId: string | null;
  /** True once the server has acknowledged this device at least once. */
  registered: boolean;
  /**
   * Why the server would not accept this device, when it said.
   *
   * Registration failing is usually just "no connection", which needs no
   * words. But two answers are REFUSALS with a specific cause and a specific
   * remedy — this till was signed out by the owner, or this browser's device
   * id already belongs to another shop — and losing them leaves an owner
   * reading "No tills yet" about a device that is sitting right in front of
   * them, announcing itself, and being turned away every time.
   */
  registrationRefusal: string | null;
  /**
   * The shop's ceiling, in days, as the server reported it. Null = not known
   * yet, which is treated as "do not warn about something unmeasured".
   */
  offlineDays: number | null;
  /**
   * How long THIS device has been out of contact, in hours, measured locally
   * from the last successful request.
   *
   * Local rather than server-reported on purpose: the number is needed most in
   * exactly the situation where the server cannot be asked. Null means this
   * device has never reached the server at all — a new tablet, not a stale one.
   */
  hoursOffline: number | null;
  /** Will the browser keep what has not been sent? */
  storage: StorageHealth | null;
  /** How many sales are sitting in the outbox, unsent. */
  pending: number;
  /**
   * A flush in progress, and how far it has got. Null when nothing is sending.
   *
   * The one moment a shopkeeper most wants to be told something: the line has
   * just come back and a day's takings are going up. Without it the pill went
   * straight from "47 saved here" to "Online" with a silent gap in between —
   * and a gap is where somebody starts pressing things.
   */
  syncing: { sent: number; total: number } | null;

  setDevice: (id: string) => void;
  setRegistered: (registered: boolean, refusal?: string | null) => void;
  setPolicy: (offlineDays: number | null) => void;
  setStorage: (storage: StorageHealth) => void;
  setPending: (pending: number) => void;
  setSyncing: (syncing: { sent: number; total: number } | null) => void;
  /** Re-read the local clock. Called on boot and whenever connectivity flips. */
  refreshHoursOffline: () => void;
}

export const useOfflineStore = create<OfflineState>()((set) => ({
  deviceId: null,
  registered: false,
  registrationRefusal: null,
  offlineDays: null,
  hoursOffline: hoursSinceContact(),
  storage: null,
  pending: 0,
  syncing: null,

  setDevice: (deviceId) => set({ deviceId }),
  setRegistered: (registered, refusal = null) => set({ registered, registrationRefusal: refusal }),
  setPolicy: (offlineDays) => set({ offlineDays }),
  setStorage: (storage) => set({ storage }),
  setPending: (pending) => set({ pending }),
  setSyncing: (syncing) => set({ syncing }),
  refreshHoursOffline: () => set({ hoursOffline: hoursSinceContact() }),
}));

/**
 * Where a till stands, given how long it has been out of contact and the
 * ceiling its shop was given.
 *
 * A pure function on purpose: this is the rule the indicator, the
 * acknowledgement prompt and the owner's roster all read, and a rule that can
 * be checked without a browser is a rule that stays correct.
 *
 * ── Why HOURS against a window measured in DAYS ─────────────────────────
 *
 * An admin sets the window in days, because that is the human unit and it sits
 * beside branches and staff. But the till cannot degrade in days: on a one-day
 * window, whole days give exactly two readings — 0 and 1 — so a shop would go
 * from fine to refused with no warning in between. Measured in hours the same
 * window warns at 18 and stops at 24, and every wider window keeps its warning
 * proportional. A test over every window an admin can set pins this.
 *
 * `reachable` wins over everything. A till in contact with the server is green
 * whatever its history — it has just proved the point.
 *
 * `hoursOffline` of null means this device has never heard from the server at
 * all, which is a brand new tablet rather than a stale one. Treating that as
 * maximally out of contact would refuse a shop on its first morning.
 */
export function standing(
  reachable: boolean,
  hoursOffline: number | null,
  offlineDays: number | null,
): OfflineStanding {
  if (reachable) return "green";
  // No ceiling known means nothing to measure against; no history means nothing
  // to measure. Silence beats a warning derived from a number nobody supplied.
  if (offlineDays === null || offlineDays <= 0) return "unknown";
  if (hoursOffline === null) return "unknown";

  const windowHours = offlineDays * 24;

  if (hoursOffline >= windowHours) return "red";
  if (hoursOffline >= windowHours * AMBER_AT) return "amber";

  return "green";
}

/**
 * What the pill says. One place, because the wording is the feature.
 *
 * "47 pending" reads as a fault and frightens a shopkeeper. "47 saved here"
 * says the thing that is actually true and is the thing they need to know:
 * the sales are not lost, they are on this device waiting for a line.
 */
export function pillLabel(
  reachable: boolean,
  pending: number,
  syncing: { sent: number; total: number } | null,
  online: boolean,
): string {
  if (syncing) return `Sending ${syncing.sent} of ${syncing.total}`;
  if (reachable) return pending > 0 ? `${pending} still to send` : "Online";

  // A network that is up while the server is not answering is a DIFFERENT
  // sentence, and the till learned it before this function did — it had been
  // saying "No server" from its own inline copy of this wording for as long as
  // the pill has existed. It matters because the two have different remedies:
  // "Offline" means wait for the line, "No server" means telephone somebody.
  // Selling carries on either way.
  const dark = online ? "No server" : "Offline";

  return pending > 0 ? `${dark} · ${pending} saved here` : dark;
}
