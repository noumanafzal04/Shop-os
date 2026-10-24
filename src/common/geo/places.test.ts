import { describe, expect, it } from "vitest";

import { cityForPin, type PlaceCity } from "./places";

/**
 * THE CITY A MAP PIN IS IN.
 *
 * With eight cities, "any city whose name is inside the map's answer" was
 * harmless. With 458, a short name hides inside a long one — "Uch" is in
 * "Kuchlak" — and a shop is filed in the wrong town.
 */
const city = (name: string, lat: number | null, lng: number | null): PlaceCity => ({
  id: name.toLowerCase(), name, province_id: 1, country_id: 167, latitude: lat, longitude: lng,
});

const cities = [
  city("Lahore", 31.558, 74.3507),
  city("Uch", 29.235, 71.065),
  city("Kuchlak", 30.411, 66.968),
  city("Muzaffarabad", 34.37, 73.471),
  city("Karachi", 24.8608, 67.0104),
];

describe("finding the city a pin is in", () => {
  it("takes the exact name, however the map writes it", () => {
    expect(cityForPin(cities, "Lahore", null)?.name).toBe("Lahore");
    expect(cityForPin(cities, "  lahore ", null)?.name).toBe("Lahore");
    // The map answers with accent marks; the list is written plainly.
    expect(cityForPin(cities, "Muzaffarābād", null)?.name).toBe("Muzaffarabad");
  });

  it("never finds a short name inside a long one", () => {
    // Kuchlak is in Balochistan; "Uch" is 500 km away in Punjab.
    expect(cityForPin(cities, "Kuchlak Bazaar", { lat: 30.41, lng: 66.97 })?.name).toBe("Kuchlak");
    expect(cityForPin(cities, "Kuchlak Bazaar", null)).toBeNull();
  });

  it("falls back to the nearest city to the pin, when the name is not one", () => {
    // "Lahore Cantonment" is not a city on the list; the pin is in Lahore.
    expect(cityForPin(cities, "Lahore Cantonment", { lat: 31.51, lng: 74.38 })?.name).toBe("Lahore");
  });

  it("says nothing rather than guess a city that is far away", () => {
    // A pin in the desert, 200 km from every city on the list.
    expect(cityForPin(cities, "Somewhere", { lat: 27.5, lng: 64.5 })).toBeNull();
  });

  it("skips cities with no coordinates when measuring", () => {
    expect(cityForPin([city("Nowhere", null, null)], "x", { lat: 31.5, lng: 74.3 })).toBeNull();
  });
});
