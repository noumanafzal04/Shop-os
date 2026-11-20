import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";

/**
 * A zone the admin draws fences ITS city (2026-11-20: "pehle city choose kry,
 * uska geo fence"). The home screen's "are we delivering here?" question must
 * therefore name the pin's city, or the server can only guess the nearest one.
 */
const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

describe("the service-area question names the city", () => {
  it("home asks with the pin's city", () => {
    expect(read("src/modules/marketplace/screens/CustomerHomeScreen.tsx")).toMatch(
      /useServiceArea\(pin\.lat, pin\.lng, pin\.city_id\)/,
    );
  });

  it("the city is part of the cache key and of the request", () => {
    const hook = read("src/modules/marketplace/hooks/useMarketplace.ts");
    expect(hook).toMatch(/queryKey: \["market", "service-area", at, cityId \?\? null\]/);
    const svc = read("src/modules/marketplace/services/marketplaceService.ts");
    expect(svc).toMatch(/city_id: cityId/);
  });
});
