import { queryClient } from "../api/queryClient";
import { useAuthStore } from "../../stores/authStore";
import { heldFor, ownerOf, stillStands } from "./kept";
import { useKeptStore } from "./keptStore";

/**
 * THE SERVER SAYS WHEN THE SHELL'S KEPT ANSWERS NO LONGER STAND.
 *
 * Keeping who-am-I, the shop's settings and its branches on the device means
 * a screen opens without asking for them. Left at that, it also means a
 * change made somewhere else does not show: an admin switches Delivery on
 * and says "refresh the page", and the page opens from what the device kept.
 *
 * So every signed-in answer carries `X-Shell-Stamp` — a short hash of the
 * rows those answers are made from (`StampTheShell` on the server). This is
 * where it is heard. The same as last time: nothing happens, and that is
 * nearly every answer. Different: the kept answers are asked for again.
 *
 * It costs no request of its own. The stamp rides on whatever the device was
 * asking anyway, so a change reaches a device with the next thing it does.
 */

/** The header, as axios hands it over. */
export const SHELL_STAMP_HEADER = "x-shell-stamp";

/**
 * The answers the stamp speaks for: where each is read from, and the name it
 * is kept under on the device (none for who-am-I, which the session store
 * keeps, and none for the module list, which is not kept at all).
 *
 * Each is made only from the shop's row, the person's row, the shop's plan
 * and its branches — which is exactly what moves the stamp. The bell and the
 * count beside "Orders" are not here: they have their own news.
 */
export const STAMPED: ReadonlyArray<{ queryKey: readonly string[]; path: string; keptAs?: string }> = [
  { queryKey: ["auth", "me"], path: "/auth/me" },
  { queryKey: ["shop-settings"], path: "/shop/settings", keptAs: "shop-settings" },
  { queryKey: ["branches"], path: "/branches", keptAs: "branches" },
  { queryKey: ["shop", "modules"], path: "/shop/modules" },
];

const ownerNow = (): string | null => {
  const { user } = useAuthStore.getState();

  return ownerOf(user?.tenant?.id, user?.id);
};

/** The stamp this person was last sent, or null. */
export function stampNow(): string | null {
  const owner = ownerNow();
  const record = useKeptStore.getState().record;

  return owner !== null && record !== null && record.owner === owner ? (record.stamp ?? null) : null;
}

/** The stamp one of the answers above was heard under, if the device knows. */
function heardUnder(answer: (typeof STAMPED)[number], owner: string): string | null | undefined {
  if (answer.path === "/auth/me") return useAuthStore.getState().userUnder;
  if (answer.keptAs === undefined) return undefined;

  return heldFor(useKeptStore.getState().record, owner, answer.keptAs)?.under;
}

/**
 * An answer arrived carrying this stamp — or none.
 *
 * `from` is what was asked, when it was a plain read: the answer to
 * `/shop/settings` IS the shop's settings as they now stand, and asking for
 * them again because of the stamp it came with would be asking twice.
 *
 * Two things make a kept answer worth asking for again:
 *
 *   the stamp MOVED       from one this person had already been sent. Every
 *                         answer it speaks for is asked for.
 *   it never matched      an answer on the device was heard under a stamp
 *                         that is not this one — though this is the first
 *                         stamp heard on this visit, so nothing "moved". A
 *                         device that lost its note of the last stamp and
 *                         kept the answers would otherwise trust them.
 *
 * Never throws: it is called from inside every request the app makes.
 */
export function heardShellStamp(stamp: unknown, from?: { method?: string; path?: string }): void {
  if (typeof stamp !== "string" || stamp === "") return;

  try {
    const owner = ownerNow();
    if (owner === null) return;

    const heard = useKeptStore.getState().hear(owner, stamp);
    // Nearly every answer. Nothing is looked at, let alone asked — and an
    // answer that keeps failing cannot set itself off again from here.
    if (heard === "same") return;

    const read = (from?.method ?? "get").toLowerCase() === "get" ? (from?.path ?? "").split("?")[0] : "";
    const asking = STAMPED.filter((answer) => answer.path !== read && (heard === "moved" || !stillStands(heardUnder(answer, owner), stamp)));
    if (asking.length === 0) return;

    // AFTER whoever was waiting on this answer has acted on it, and only for
    // what they did not ask for themselves.
    //
    // The commonest way a stamp moves is this device saving something: the
    // save's own answer carries the new stamp. The screen that saved then
    // asks for what it knows it changed — and this, a moment earlier, had
    // asked for the same things, so each went over the wire twice (three
    // requests doubled on every Settings save, counted in a browser).
    //
    // So it waits one turn and looks: an answer that has been asked for since
    // the stamp was heard — in the air, or already back — is the fresh one,
    // and is left alone. Only what nobody asked for is asked for here.
    const heardAt = Date.now();
    setTimeout(() => {
      for (const answer of asking) {
        const state = queryClient.getQueryState(answer.queryKey);
        if (state !== undefined && (state.fetchStatus === "fetching" || state.dataUpdatedAt >= heardAt)) continue;
        void queryClient.invalidateQueries({ queryKey: answer.queryKey, exact: true }, { cancelRefetch: false });
      }
    }, 0);
  } catch {
    // A stamp that could not be acted on is a device that waits out the clock.
  }
}
