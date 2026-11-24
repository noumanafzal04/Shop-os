import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";
import { shutLabel, shutLine } from "../src/modules/marketplace/shutLabel";

/**
 * A SHOP THAT PAUSED ORDERS SAYS "BUSY", NOT "CLOSED". The partner app's Busy
 * switch makes the shop unorderable for a while; "Closed" read as shut for the
 * day. The server sends `is_busy`; every card and the shop page use one word.
 */
const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

describe("busy, not closed", () => {
  it("picks the word from the server's is_busy", () => {
    expect(shutLabel({ is_busy: true })).toBe("Busy");
    expect(shutLabel({ is_busy: false })).toBe("Closed");
    expect(shutLabel(null)).toBe("Closed");
    expect(shutLine({ is_busy: true })).toBe("Busy right now");
    expect(shutLine({})).toBe("Closed for now");
  });

  it("no card or shop page spells 'Closed' itself any more", () => {
    for (const rel of [
      "src/modules/marketplace/components/ShopWithItems.tsx",
      "src/modules/marketplace/components/ShopFactsRow.tsx",
      "src/modules/marketplace/screens/CustomerHomeScreen.tsx",
      "src/modules/marketplace/screens/MarketShopScreen.tsx",
    ]) {
      const code = read(rel);
      expect(code).not.toMatch(/>Closed</);
      expect(code).not.toMatch(/"Closed"/);
      expect(code).toMatch(/shut(Label|Line)\(/);
    }
  });
});
