import { create } from "zustand";
import { persist } from "zustand/middleware";

import { noteStorage } from "./deviceStorage";
import type { KeptRecord } from "./kept";

/**
 * The answers the shell keeps between loads — see `kept.ts` for why they are
 * kept and when they are asked for again.
 *
 * One record, and it is somebody's: `keep` starts a new one the moment the
 * owner changes, so a shop's settings are never carried into the next shop
 * signed in on this device, nor one person's bell into the next person's.
 * Reading goes through `heldFor`, which hands back nothing that is not the
 * reader's.
 */
export type Heard = "same" | "first" | "moved";

interface KeptState {
  record: KeptRecord | null;
  /** The server answered. Kept under the stamp it is standing at. */
  keep: (owner: string, name: string, data: unknown, at: number) => void;
  /**
   * The server sent its stamp.
   *
   *   "same"    what this person was sent last time — nearly every answer
   *   "first"   the first this person has been sent on this device
   *   "moved"   different from one they had already been sent
   */
  hear: (owner: string, stamp: string) => Heard;
  /** Somebody signed out. Nothing of theirs stays on the device. */
  forget: () => void;
}

export const useKeptStore = create<KeptState>()(
  persist(
    (set, get) => ({
      record: null,
      keep: (owner, name, data, at) =>
        set((s) => {
          const mine = s.record !== null && s.record.owner === owner ? s.record : null;
          const stamp = mine?.stamp ?? null;

          return { record: { owner, stamp, held: { ...(mine?.held ?? {}), [name]: { data, at, under: stamp } } } };
        }),
      hear: (owner, stamp) => {
        const record = get().record;
        const mine = record !== null && record.owner === owner ? record : null;
        const before = mine?.stamp ?? null;
        // Said on every answer, and nearly always the same. Writing it down
        // each time would be a write to the device per request.
        if (before === stamp) return "same";

        set({ record: { owner, held: mine?.held ?? {}, stamp } });

        return before === null ? "first" : "moved";
      },
      forget: () => set({ record: null }),
    }),
    // A browser that will not store is a browser that asks again — never one
    // that fails the answer it was asked to keep (deviceStorage.ts).
    { name: "shopos-kept", storage: noteStorage() },
  ),
);
