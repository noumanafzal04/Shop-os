import { distanceLabel, mapsUrl } from "../src/common/maps";
import { PROJECT_ROOT, fs, path } from "./support/node";

/**
 * "WHERE IS MY RIDER."
 *
 * ── The bug ──────────────────────────────────────────────────────────
 *
 * The rider's live coordinates have been on the customer's order payload since
 * the tracking screen existed. The screen read them to decide ONE thing:
 * whether to draw a green dot captioned "Live". The coordinates themselves
 * were thrown away.
 *
 * So the single number the screen is pulled down to refresh for — how far away
 * they are — was on the wire, understood by nobody, and answered by a colour.
 * Same shape as the notification payload, where `type` and `data` arrived for
 * months and every row looked identical.
 *
 * The distance is computed on the server, where `Geo::distanceKm` already
 * lives. This tests the two things the phone owns: how the number is worded,
 * and that the screen actually asks for it.
 */

describe("how far away, in words", () => {
  it("hedges, because the number is a straight line", () => {
    // A rider 1.2 km away across a canal with one bridge is fifteen minutes.
    // "1.2 km" without a hedge is a promise about a road nobody looked at.
    expect(distanceLabel(1.4)).toBe("About 1.4 km away");
  });

  it("speaks metres under a kilometre", () => {
    // "0.3 km" is a number nobody pictures.
    expect(distanceLabel(0.3)).toBe("About 300 m away");
  });

  it("rounds metres to fifty, because a GPS fix is not accurate to ten", () => {
    // Printing 287 m claims a precision the pin does not have.
    expect(distanceLabel(0.287)).toBe("About 300 m away");
    expect(distanceLabel(0.42)).toBe("About 400 m away");
  });

  it("never says a rider is 0 m away", () => {
    // They are at the door, not inside the flat. A floor of fifty metres is
    // the difference between "here" and a bug.
    expect(distanceLabel(0)).toBe("About 50 m away");
    expect(distanceLabel(0.01)).toBe("About 50 m away");
  });

  it("drops the decimal past ten kilometres", () => {
    // 12.3 vs 12 km is not a difference to anybody waiting.
    expect(distanceLabel(12.34)).toBe("About 12 km away");
    expect(distanceLabel(9.9)).toBe("About 9.9 km away");
  });

  it("says nothing at all when the distance is not known", () => {
    /**
     * THE CASE THAT MATTERS MOST.
     *
     * Plenty of orders are a typed address with no coordinates, and the pin is
     * null whenever the rider has not picked up or their phone has gone quiet.
     * A helper that returned "About 0 km away" for those would put a rider at
     * the customer's door for the whole of a delivery that has not started.
     */
    expect(distanceLabel(null)).toBeNull();
    expect(distanceLabel(undefined)).toBeNull();
    expect(distanceLabel(NaN)).toBeNull();
    expect(distanceLabel(-1)).toBeNull();
  });
});

describe("the maps hand-off", () => {
  it("builds a URL the platform's maps app answers", () => {
    // Jest runs the iOS half of `Platform.OS` under the react-native preset;
    // both branches are one line and the shape is what matters.
    const url = mapsUrl(31.5204, 74.3587, "Your rider");
    expect(url).toMatch(/31\.5204/);
    expect(url).toMatch(/74\.3587/);
  });

  it("escapes the label, because it goes inside a query string", () => {
    // `geo:` puts the label in brackets after `q=`. An unescaped space or
    // bracket truncates the intent and the pin arrives without a name — or
    // does not arrive.
    const label = "Ayesha's rider (bike)";
    expect(mapsUrl(1, 2, label)).not.toContain("Ayesha's rider (bike)");
  });
});

describe("the screen asks for it", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8");

  const screen = read("src/modules/orders/screens/OrderTrackingScreen.tsx");

  it("reads the distance the server sends", () => {
    // The whole bug was a payload field with no reader. Without this, deleting
    // the line changes no test.
    expect(screen).toMatch(/distanceLabel\(o\?\.rider\?\.distance_km\)/);
    expect(screen).toMatch(/\{!!away && <Text style=\{styles\.riderAway\}>\{away\}<\/Text>\}/);
  });

  it("offers the map only while there is a live fix", () => {
    // A button that opens a map of nowhere is worse than no button.
    expect(screen).toMatch(
      /o\.rider\.latitude != null && o\.rider\.longitude != null && \(/,
    );
  });

  it("uses the shared URL builder, not its own platform switch", () => {
    // The rider's screen had this logic first. Two copies of a platform switch
    // is two places to fix the day one of them stops resolving.
    expect(screen).toMatch(/mapsUrl\(lat, lng, "Your rider"\)/);
    expect(screen).not.toMatch(/maps\.apple\.com/);
    expect(screen).not.toMatch(/`geo:/);
  });

  it("still hands the rider's own screen the same builder", () => {
    // The denominator: the extraction has to leave the original caller working
    // off it, or this is one copy plus one copy.
    const rider = read("src/modules/rider/screens/RiderJobScreen.tsx");
    expect(rider).toMatch(/mapsUrl\(lat, lng, label \?\? "Delivery"\)/);
    expect(rider).not.toMatch(/maps\.apple\.com/);
  });
});
