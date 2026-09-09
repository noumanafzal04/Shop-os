import { PermissionsAndroid, Platform } from "react-native";
import Geolocation from "@react-native-community/geolocation";
import { askForLocation, currentPosition } from "../src/services/position";

/**
 * "USKO LOCATION NI MIL RHI" — TWICE, ON BOTH SIDES OF THE APP.
 *
 * A shopper whose pin stayed blank so nothing could be searched, and a rider
 * who could not go online. Two reports, two screens, one cause each:
 *
 *   1. Only `ACCESS_FINE_LOCATION` was requested. Since Android 12 the system
 *      dialog offers **Precise** and **Approximate**, and somebody who taps
 *      Allow with Approximate selected grants COARSE and DENIES fine — so the
 *      request came back `denied` after they pressed Allow, and both screens
 *      told them to allow a permission they had just allowed.
 *
 *   2. A high-accuracy fix waits for satellites. Indoors that is a timeout,
 *      and a timeout was reported as "check that GPS is on" about a phone
 *      whose GPS was on.
 *
 * There were also TWO copies of the permission prompt — `locationStore` had
 * its own beside the rider's — so both bugs existed twice. This file tests the
 * one copy that is left.
 */
const FINE = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
const COARSE = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;

const position = Geolocation.getCurrentPosition as jest.Mock;

/** Queue one answer per call, in order. */
function answers(...replies: Array<{ coords?: { latitude: number; longitude: number }; code?: number }>) {
  position.mockReset();
  for (const reply of replies) {
    position.mockImplementationOnce((ok: Function, fail: Function) => {
      if (reply.coords) ok({ coords: reply.coords });
      else fail({ code: reply.code });
    });
  }
}

describe("asking for location on Android", () => {
  const platform = Platform.OS;

  beforeEach(() => {
    (Platform as { OS: string }).OS = "android";
    (PermissionsAndroid.check as jest.Mock) = jest.fn(() => Promise.resolve(false));
    (PermissionsAndroid.requestMultiple as jest.Mock) = jest.fn();
  });

  afterAll(() => {
    (Platform as { OS: string }).OS = platform;
  });

  it("accepts Approximate — the answer that used to read as a refusal", async () => {
    (PermissionsAndroid.requestMultiple as jest.Mock).mockResolvedValue({
      [FINE]: "denied",
      [COARSE]: "granted",
    });

    await expect(askForLocation("needs it")).resolves.toBe(true);
  });

  it("still accepts Precise", async () => {
    (PermissionsAndroid.requestMultiple as jest.Mock).mockResolvedValue({
      [FINE]: "granted",
      [COARSE]: "granted",
    });

    await expect(askForLocation("needs it")).resolves.toBe(true);
  });

  it("reports a real refusal as a refusal", async () => {
    // The other half of the rule. Accepting coarse must not turn "never ask
    // again" into a yes, or the caller waits for a fix that cannot come.
    (PermissionsAndroid.requestMultiple as jest.Mock).mockResolvedValue({
      [FINE]: "never_ask_again",
      [COARSE]: "never_ask_again",
    });

    await expect(askForLocation("needs it")).resolves.toBe(false);
  });

  it("asks for both in ONE dialog", async () => {
    // Two sequential requests is two dialogs shown to somebody who has
    // already answered.
    (PermissionsAndroid.requestMultiple as jest.Mock).mockResolvedValue({
      [FINE]: "granted",
      [COARSE]: "granted",
    });

    await askForLocation("needs it");

    expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledTimes(1);
    expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledWith([FINE, COARSE]);
  });

  it("does not ask again when it already has coarse", async () => {
    (PermissionsAndroid.check as jest.Mock).mockResolvedValue(true);

    await expect(askForLocation("needs it")).resolves.toBe(true);
    expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
  });
});

describe("taking a fix", () => {
  it("retries without high accuracy when the satellites time out", async () => {
    /**
     * The whole reason a rider indoors could not go on duty. First attempt
     * times out; the second asks the network provider and a cached position,
     * which is a far better answer than none.
     */
    answers({ code: 3 }, { coords: { latitude: 24.8, longitude: 67.03 } });

    const result = await currentPosition({ highAccuracy: true });

    expect(result.fix).toEqual({ latitude: 24.8, longitude: 67.03 });
    expect(position).toHaveBeenCalledTimes(2);
    expect(position.mock.calls[0][2].enableHighAccuracy).toBe(true);
    expect(position.mock.calls[1][2].enableHighAccuracy).toBe(false);
    // And the retry is allowed to answer with a cached position.
    expect(position.mock.calls[1][2].maximumAge).toBeGreaterThan(
      position.mock.calls[0][2].maximumAge,
    );
  });

  it("does not retry a refusal", async () => {
    // The answer would not change, and the caller has a different sentence
    // for it.
    answers({ code: 1 });

    const result = await currentPosition({ highAccuracy: true });

    expect(result.fix).toBeNull();
    expect(result.why).toBe("denied");
    expect(position).toHaveBeenCalledTimes(1);
  });

  it("names the reason rather than answering a bare null", async () => {
    /**
     * Three causes used to arrive as one `null`: no permission, services off,
     * and a timeout. They need three different sentences — "allow location",
     * "switch on GPS", "try again" — and the rider screen showed the GPS one
     * for all three.
     */
    answers({ code: 2 }, { code: 2 });
    await expect(currentPosition()).resolves.toEqual({ fix: null, why: "unavailable" });

    answers({ code: 3 }, { code: 3 });
    await expect(currentPosition()).resolves.toEqual({ fix: null, why: "timeout" });
  });

  it("never throws", async () => {
    // A caller that has to catch as well as check is a caller that will
    // forget one.
    answers({ code: 999 }, { code: 999 });

    await expect(currentPosition()).resolves.toEqual({ fix: null, why: "unavailable" });
  });
});
