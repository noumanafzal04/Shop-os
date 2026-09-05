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
 * rationale dialog — wrong.
 */

export interface Fix {
  latitude: number;
  longitude: number;
}

/**
 * Ask for permission, once.
 *
 * Returns false for a refusal AND for a phone that never asks (iOS handles it
 * inside `getCurrentPosition`), because the only thing a caller can do with
 * either answer is the same: carry on without a fix.
 */
export async function askForLocation(reason: string): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: "Location",
      message: `${BRAND.name} ${reason}`,
      buttonPositive: "Allow",
    },
  );

  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * A fix, or null.
 *
 * NEVER throws. A timeout, location services switched off and a refusal are
 * three causes of one situation — we do not know where the phone is — and a
 * caller that has to catch as well as check is a caller that will forget one.
 */
export function currentPosition(options?: { highAccuracy?: boolean; timeoutMs?: number }): Promise<Fix | null> {
  return new Promise((resolve) => {
    Geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      {
        // A rider's pin decides which jobs they are shown, so it is worth the
        // battery; a shopper only needs their city, and is not.
        enableHighAccuracy: options?.highAccuracy ?? false,
        timeout: options?.timeoutMs ?? 12000,
        maximumAge: options?.highAccuracy ? 15000 : 300000,
      },
    );
  });
}
