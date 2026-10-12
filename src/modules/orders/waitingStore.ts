import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Kept, KeptCount } from "./waitingCount";

/**
 * The count beside "Orders", kept on the device between loads — see
 * `waitingCount.ts` for why it is kept and when it is asked for again.
 *
 * One record, and it is somebody's: `keep` and `hear` start a new one the
 * moment the owner changes, so one shop's count is never carried into
 * another's, nor one person's into the next who signs in at the same
 * counter. Reading it goes through `keptFor`, which hands back nothing that
 * is not the reader's.
 */
interface WaitingState {
  kept: Kept | null;
  /** The server (or the Orders screen) said how many. */
  keep: (owner: string, count: KeptCount) => void;
  /** The newest order news on the bell has been acted on. */
  hear: (owner: string, heard: string | null) => void;
}

const of = (kept: Kept | null, owner: string): Kept => (kept !== null && kept.owner === owner ? kept : { owner });

export const useWaitingStore = create<WaitingState>()(
  persist(
    (set) => ({
      kept: null,
      keep: (owner, count) => set((s) => ({ kept: { ...of(s.kept, owner), count } })),
      hear: (owner, heard) => set((s) => ({ kept: { ...of(s.kept, owner), heard } })),
    }),
    { name: "shopos-orders-waiting" },
  ),
);
