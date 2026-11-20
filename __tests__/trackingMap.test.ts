import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";
import { isPin, MARGIN, MIN_DELTA, trackingRegion } from "../src/modules/orders/trackingMap";

/**
 * THE RIDER ON A MAP INSIDE THE APP. The tracking screen only offered "See on
 * map" (the phone's maps app). Now the bike and the door are drawn together,
 * re-framed on every 10-second answer while the order is out for delivery.
 */
describe("what the tracking map frames", () => {
  const rider = { lat: 31.5204, lng: 74.3587 };
  const home = { lat: 31.47, lng: 74.27 };

  it("frames both pins with a margin", () => {
    const r = trackingRegion(rider, home)!;
    expect(r.latitude).toBeCloseTo((rider.lat + home.lat) / 2, 6);
    expect(r.longitude).toBeCloseTo((rider.lng + home.lng) / 2, 6);
    expect(r.latitudeDelta).toBeCloseTo((rider.lat - home.lat) * MARGIN, 6);
    expect(r.longitudeDelta).toBeCloseTo((rider.lng - home.lng) * MARGIN, 6);
  });

  it("centres on the rider alone at street level when there is no door pin", () => {
    expect(trackingRegion(rider, null)).toEqual({
      latitude: rider.lat,
      longitude: rider.lng,
      latitudeDelta: MIN_DELTA,
      longitudeDelta: MIN_DELTA,
    });
  });

  it("never zooms past street level for two pins a few metres apart", () => {
    const r = trackingRegion(rider, { lat: rider.lat + 0.0001, lng: rider.lng })!;
    expect(r.latitudeDelta).toBe(MIN_DELTA);
  });

  it("draws nothing without a pin, and rejects broken numbers", () => {
    expect(trackingRegion(null, null)).toBeNull();
    expect(isPin({ lat: Number.NaN, lng: 74 })).toBe(false);
    expect(isPin({ lat: 31 } as never)).toBe(false);
  });

  it("the tracking screen draws it from the live rider pin and the order's door", () => {
    const screen = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "src/modules/orders/screens/OrderTrackingScreen.tsx"), "utf8"),
    );
    expect(screen).toMatch(/<TrackingMap\s+rider=\{\{ lat: o\.rider\.latitude, lng: o\.rider\.longitude \}\}/);
    expect(screen).toMatch(/o\.delivery_latitude != null && o\.delivery_longitude != null/);
  });
});
