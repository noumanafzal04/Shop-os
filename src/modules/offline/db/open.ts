import { DB_NAME, DB_VERSION, type StoreName, upgrade } from "./schema";

/**
 * A promise wrapper over IndexedDB, and nothing more.
 *
 * Written rather than pulled in: the surface the till needs is get, put,
 * getAll, delete and count, and the parts that actually matter — the upgrade
 * path, and what a browser does when it refuses or reclaims the database — are
 * worth owning outright rather than inheriting.
 *
 * IndexedDB's failure modes are quiet. A blocked upgrade never fires an error,
 * it simply never fires anything, and a till that hangs on boot with nothing on
 * screen is indistinguishable from a broken one. Every path below resolves,
 * rejects, or says why.
 *
 * One rule runs through all of it: **a result is only real once the TRANSACTION
 * completes.** A request can succeed inside a transaction that then aborts, and
 * treating that as written is exactly how a sale gets reported saved and is not.
 * So every helper captures the request's result and resolves on `oncomplete`.
 */

/** Nothing here works without IndexedDB — Safari private mode included. */
export function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    // Some browsers throw on merely READING the property in a blocked context.
    return false;
  }
}

let cached: Promise<IDBDatabase> | null = null;

/**
 * Open the till's database, creating or upgrading it as needed.
 *
 * Cached, because a second connection held open elsewhere is precisely what
 * blocks an upgrade. The cache clears itself if the connection closes — a
 * browser reclaiming storage does that without asking.
 */
export function openDb(): Promise<IDBDatabase> {
  if (!indexedDbAvailable()) {
    return Promise.reject(new Error("This browser has no local storage for the till."));
  }

  if (cached) return cached;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => upgrade(request.result, event.oldVersion);

    request.onsuccess = () => {
      const db = request.result;

      // Another tab wants a version this connection is holding up. Close ours
      // so the upgrade proceeds; the next call reopens at the new version.
      db.onversionchange = () => {
        db.close();
        if (cached === opening) cached = null;
      };

      // The browser can close a connection out from under the page when it
      // reclaims storage. Forget it, or every later call fails on a dead handle.
      db.onclose = () => {
        if (cached === opening) cached = null;
      };

      resolve(db);
    };

    request.onerror = () => {
      if (cached === opening) cached = null;
      reject(request.error ?? new Error("The till's local storage could not be opened."));
    };

    // Fires when an older connection elsewhere holds the version back. It is
    // not an error and no error event follows, so without this the caller waits
    // forever with nothing on screen.
    request.onblocked = () => {
      if (cached === opening) cached = null;
      reject(new Error("Another CartZe tab is holding the till's storage. Close it and try again."));
    };
  });

  cached = opening;

  return opening;
}

/** Drop the cached handle. Tests reopen; production reopens after a close. */
export function resetDbCache(): void {
  cached = null;
}

type Mode = "readonly" | "readwrite";

/**
 * Issue one request inside its own transaction and resolve with its result
 * once that transaction COMMITS.
 *
 * `work` must return the request synchronously. A transaction closes the moment
 * the event loop turns with nothing pending, so anything awaited inside one is
 * a silent abort — which is why this signature makes awaiting impossible.
 */
export async function run<T>(
  store: StoreName,
  mode: Mode,
  work: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();

  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction([store], mode);
    let value: T;

    const request = work(transaction.objectStore(store));
    request.onsuccess = () => {
      value = request.result;
    };

    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("The till's local storage rejected a write."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("The till's local storage aborted a write."));
  });
}

/**
 * Issue MANY requests inside ONE transaction — all of them commit or none do.
 *
 * The catalog arrives as thousands of rows and a half-written one is worse than
 * none: a barcode that resolves to a row whose price never landed would sell at
 * the wrong money. One transaction makes that impossible.
 */
export async function runAll(
  store: StoreName,
  mode: Mode,
  work: (s: IDBObjectStore) => void,
): Promise<void> {
  const db = await openDb();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([store], mode);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("The till's local storage rejected a write."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("The till's local storage aborted a write."));

    try {
      work(transaction.objectStore(store));
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}
