import { PermissionsAndroid, Platform } from "react-native";
import Geolocation from "@react-native-community/geolocation";
import { BRAND } from "../common/brand";

/**
 * "Where is this phone, now."
 *
 * One copy, two callers who want it for completely different reasons: a
 * shopper resolving their city once at launch, and a rider whose position is
 * the thing shops are matched against for a whole shift. Two copies of a
 * permission prompt is two places to get the wording — and the Android
 * rationale dialog — wrong. `locationStore` had a second copy and this is now
 * the only one.
 */

export interface Fix {
  latitude: number;
  longitude: number;
}

/**
 * ASK FOR PERMISSION — AND ACCEPT THE ANSWER ANDROID ACTUALLY GIVES.
 *
 * ── The bug this replaces ────────────────────────────────────────────
 *
 * It requested `ACCESS_FINE_LOCATION` alone. Since Android 12 the system
 * dialog offers **Precise** and **Approximate**, and a person who taps Allow
 * with Approximate selected grants COARSE and denies FINE — so a request for
 * FINE alone comes back `denied` after the user pressed Allow. Both callers
 * then said "allow location to continue" to somebody who just had.
 *
 * Reported as a rider who could not go online.
 *
 * So both are requested and EITHER is enough. Approximate is a few hundred
 * metres, which is smaller than the delivery radius and much smaller than a
 * city — it answers both questions this app asks of a position.
 */
export async function askForLocation(reason: string): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  const wanted = [
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
  ];

  /**
   * `requestMultiple` shows ONE dialog for both, and returns a verdict per
   * permission. Asking twice in sequence would show a second dialog to
   * somebody who has already answered.
   *
   * It also takes no rationale text, so the reason is written into the
   * `check` path below rather than lost: Android shows its own copy here, and
   * our sentence is what the toast says when this returns false.
   */
  const already = await PermissionsAndroid.check(wanted[1]);
  if (already) return true;

  const result = await PermissionsAndroid.requestMultiple(wanted);
  const granted = wanted.some((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);

  if (!granted && __DEV__) {
    console.warn(`[location] refused — ${BRAND.name} ${reason}`, result);
  }

  return granted;
}

/**
 * WHY A FIX COULD NOT BE TAKEN.
 *
 * Three causes used to arrive as one `null`: no permission, location services
 * switched off, and a timeout indoors. They need three different sentences —
 * "allow location", "switch on GPS", "try again" — and a caller holding a
 * `null` cannot tell which it has.
 */
export type FixFailure = "denied" | "unavailable" | "timeout";

export interface FixResult {
  fix: Fix | null;
  why: FixFailure | null;
}

const CODES: Record<number, FixFailure> = {
  1: "denied",
  2: "unavailable",
  3: "timeout",
};

function once(options: { highAccuracy: boolean; timeoutMs: number; maximumAge: number }) {
  return new Promise<FixResult>((resolve) => {
    Geolocation.getCurrentPosition(
      (pos) => resolve({
        fix: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
        why: null,
      }),
      (err) => resolve({ fix: null, why: CODES[err?.code as number] ?? "unavailable" }),
      {
        enableHighAccuracy: options.highAccuracy,
        timeout: options.timeoutMs,
        maximumAge: options.maximumAge,
      },
    );
  });
}

/**
 * A FIX, OR THE REASON THERE ISN'T ONE — WITH ONE RETRY.
 *
 * ── Why it asks twice ────────────────────────────────────────────────
 *
 * A high-accuracy fix waits for GPS satellites. Indoors — which is where a
 * rider stands when they go on duty, and where anybody opens an app — that is
 * a timeout, and the old code turned it straight into "could not find your
 * location, check that GPS is on" about a phone whose GPS was fine.
 *
 * So a timeout or an unavailable answer is retried WITHOUT high accuracy and
 * with a long `maximumAge`, which lets the network provider and the last known
 * position answer. A cached fix from five minutes ago is a far better answer
 * than none for both "which city am I in" and "which shops are near me".
 *
 * A refusal is NOT retried: the answer would not change and the caller has a
 * different sentence for it.
 *
 * NEVER throws. A caller that has to catch as well as check is a caller that
 * will forget one.
 */
export async function currentPosition(options?: {
  highAccuracy?: boolean;
  timeoutMs?: number;
  /**
   * ONE ATTEMPT ONLY — for a caller that a person is waiting on.
   *
   * The retry is right when the answer is what matters and nobody is watching
   * a spinner: the heartbeat, resolving a city at launch. It is wrong on the
   * duty switch. A rider pressing "go online" indoors waited twelve seconds
   * for the satellites, then eight more for the fallback, and the switch did
   * nothing visible for twenty — reported as "on click on line it a taking
   * time to be online why".
   */
  retry?: boolean;
}): Promise<FixResult> {
  const highAccuracy = options?.highAccuracy ?? false;

  const first = await once({
    highAccuracy,
    timeoutMs: options?.timeoutMs ?? 12000,
    // A CACHED fix is what makes a quick attempt quick: five minutes old is a
    // better answer than a spinner, and for "which city am I in" or "which
    // shops are near me" it is the same answer.
    maximumAge: highAccuracy ? 15000 : 300000,
  });

  if (first.fix || first.why === "denied" || options?.retry === false) return first;

  return once({ highAccuracy: false, timeoutMs: 8000, maximumAge: 600000 });
}
