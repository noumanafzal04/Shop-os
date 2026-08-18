import { run, runAll } from "./open";
import { CACHE_STORES, SINGLETON_KEY, type StoreName } from "./schema";

/**
 * The operations the till performs on its local database.
 *
 * Deliberately small. Everything above this layer speaks in rows, never in
 * transactions or requests, so there is exactly one place that knows a result
 * is not real until the transaction commits.
 */

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return run<T | undefined>(store, "readonly", (s) => s.get(key));
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  return run<T[]>(store, "readonly", (s) => s.getAll());
}

export async function put<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<void> {
  await run(store, "readwrite", (s) => (key === undefined ? s.put(value) : s.put(value, key)));
}

export async function remove(store: StoreName, key: IDBValidKey): Promise<void> {
  await run(store, "readwrite", (s) => s.delete(key));
}

export async function count(store: StoreName): Promise<number> {
  return run<number>(store, "readonly", (s) => s.count());
}

export async function clear(store: StoreName): Promise<void> {
  await run(store, "readwrite", (s) => s.clear());
}

/**
 * Write many rows as one all-or-nothing batch.
 *
 * The catalog arrives as thousands of rows, and half a catalog is worse than
 * none — a barcode resolving to a row whose price never landed would sell at
 * the wrong money.
 */
export async function putMany<T>(store: StoreName, values: readonly T[]): Promise<void> {
  if (values.length === 0) return;
  await runAll(store, "readwrite", (s) => {
    for (const value of values) s.put(value);
  });
}

/** Rows matching an index — how the flusher asks for everything still owed. */
export async function getAllByIndex<T>(
  store: StoreName,
  index: string,
  query: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
  return run<T[]>(store, "readonly", (s) => s.index(index).getAll(query));
}

// ── Single-row stores ────────────────────────────────────────────────
//
// Device identity, the sync cursor and the tax config are each ONE row. Giving
// them a fixed key means a reader never needs an id from somewhere else, and
// there is no way to end up with two.

export async function getSingleton<T>(store: StoreName): Promise<T | undefined> {
  return get<T>(store, SINGLETON_KEY);
}

export async function putSingleton<T>(store: StoreName, value: T): Promise<void> {
  await put(store, value, SINGLETON_KEY);
}

/**
 * Throw away everything the server can send again, and nothing else.
 *
 * Used when a catalog is rebuilt from scratch, or when a till is handed to a
 * different shop. It must never touch OUTBOX or SHIFT: those hold work that has
 * not reached the server, and clearing them is losing money that already
 * crossed a counter. That is why the list is derived from CACHE_STORES rather
 * than written out again here — one place decides what is disposable.
 */
export async function clearCaches(): Promise<void> {
  for (const store of CACHE_STORES) {
    await clear(store);
  }
}

/**
 * How much unsent work this till is holding. The number the cashier sees.
 *
 * NOT the row count. An acknowledged sale keeps its row — that mapping from the
 * printed slip to the real invoice number is the only thing that can answer a
 * customer holding the paper — so counting rows would show a badge reading "47
 * unsent" at a till that owes nothing, on a shop's busiest day.
 */
export async function pendingCount(): Promise<number> {
  const { owedCount } = await import("../outbox/outbox");
  const { owedShiftOps } = await import("../shift/shiftQueue");

  // Sales AND shift events. A drawer counted with no server is work owed to it
  // exactly as much as a sale is — leaving it out would show a till "Online"
  // with an unsent close still sitting on the device, which is the one reading
  // that would stop somebody chasing it.
  return (await owedCount()) + (await owedShiftOps());
}
