import { describe, expect, it } from "vitest";

import {
  clampRadius, describeZone, distanceLabel, draftFromZone, newCircleDraft, newShapeDraft, outsideWarning, whyNotSave, zonePayload,
  type ServiceZone,
} from "./zoneDraft";

describe("a service zone being drawn", () => {
  it("refuses what the server refuses, in its words, before the button", () => {
    expect(whyNotSave(newCircleDraft())).toMatch(/name/);
    expect(whyNotSave({ ...newCircleDraft(), name: "Gulberg" })).toMatch(/centre/);
    expect(whyNotSave({ ...newCircleDraft({ lat: 31.52, lng: 74.35 }), name: "Gulberg", radius_m: 20 })).toBe("A circle runs from 50 metres to 100 km.");
    expect(whyNotSave({ ...newCircleDraft({ lat: 31.52, lng: 74.35 }), name: "Gulberg" })).toBeNull();

    const road = { ...newShapeDraft(), name: "Main Bazaar road", points: [[31.52, 74.35], [31.53, 74.35]] as [number, number][] };
    expect(whyNotSave(road)).toBe("A shape needs at least 3 corners.");
    expect(whyNotSave({ ...road, points: [...road.points, [31.53, 74.36]] })).toBeNull();
  });

  it("sends only the drawn shape's own fields", () => {
    const circle = zonePayload({ ...newCircleDraft({ lat: 31.52, lng: 74.35 }), name: " Gulberg " });
    expect(circle).toEqual({ name: "Gulberg", city_id: null, kind: "circle", is_active: true, center_lat: 31.52, center_lng: 74.35, radius_m: 1000 });

    const shape = zonePayload({ ...newShapeDraft(), name: "Road", points: [[1, 2], [3, 4], [5, 6]] });
    expect(shape).toEqual({ name: "Road", city_id: null, kind: "polygon", is_active: true, points: [[1, 2], [3, 4], [5, 6]] });
    expect(shape).not.toHaveProperty("radius_m");
  });

  it("keeps a typed radius inside the server's range, in whole metres", () => {
    expect(clampRadius(20)).toBe(50);
    expect(clampRadius(762.4)).toBe(762);
    expect(clampRadius(250_000)).toBe(100_000);
    expect(clampRadius(Number.NaN)).toBe(1000);
  });

  it("reads a saved zone back as a draft — numbers as numbers", () => {
    const saved: ServiceZone = {
      id: "z1", name: "UCP", city_id: "c1", kind: "circle", center_lat: "31.4466" as unknown as number,
      center_lng: "74.2685" as unknown as number, radius_m: 762, points: null, is_active: true,
    };
    expect(draftFromZone(saved)).toMatchObject({ id: "z1", center: { lat: 31.4466, lng: 74.2685 }, radius_m: 762, points: [] });
  });

  it("says each zone the way a person reads it", () => {
    expect(distanceLabel(762)).toBe("762 m");
    expect(distanceLabel(1240)).toBe("1.2 km");
    expect(describeZone({ kind: "circle", radius_m: 762, points: null })).toBe("Circle · 762 m");
    expect(describeZone({ kind: "polygon", radius_m: null, points: [[1, 1], [2, 2], [3, 3], [4, 4]] })).toBe("Shape · 4 corners");
  });

  it("warns what an active zone leaves out — and says nothing while nothing is fenced", () => {
    expect(outsideWarning({ zones_active: 0, online_shops: 5, online_shops_outside: 0 })).toBeNull();
    expect(outsideWarning({ zones_active: 2, online_shops: 5, online_shops_outside: 0 })).toBeNull();
    expect(outsideWarning({ zones_active: 1, online_shops: 5, online_shops_outside: 1 })).toMatch(/^1 online shop is outside/);
    expect(outsideWarning({ zones_active: 1, online_shops: 5, online_shops_outside: 3 })).toMatch(/^3 online shops are outside/);
  });
});
