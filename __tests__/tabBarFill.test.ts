import { PROJECT_ROOT, fs, path } from "./support/node";

/**
 * THE ACTIVE PILL STAYS ROUND AFTER A TAP.
 *
 * "Footer ka active abhi b acha ni tha — click krny py phr border araha." The
 * tab that was active at launch drew a rounded pill; the tab you TAPPED drew a
 * square box. The pill's colour was added to the wrap only once it became
 * focused, and Fabric on a real phone skips the corner radius on a fill that
 * arrives after the first paint. Home looked right, every other tab did not —
 * so the launch screenshot can never be the check.
 *
 * The rule: the fill is drawn on every slot from the start and only its
 * opacity changes. Plus the radius rule that already bit twice: never exactly
 * half the height.
 */
const src = fs.readFileSync(path.join(PROJECT_ROOT, "src/navigation/AppTabBar.tsx"), "utf8");
const block = (name: string): string => {
  const m = new RegExp(`\\n\\s+${name}: \\{([^}]*)\\}`).exec(src);
  if (!m) throw new Error(`no style "${name}" in AppTabBar`);
  return m[1];
};
const num = (style: string, key: string): number => Number(new RegExp(`${key}: (\\d+)`).exec(style)?.[1]);

describe("tab bar active pill", () => {
  it("never gives a fill only to the focused tab", () => {
    // `focused && { backgroundColor }` / `focused ? { backgroundColor … }` — a fill born late.
    expect(src).not.toMatch(/focused\s*&&\s*\{\s*backgroundColor/);
    expect(src).not.toMatch(/focused\s*\?\s*\{\s*backgroundColor/);
  });

  it("draws the fill on every slot and switches only its opacity", () => {
    expect(src).toMatch(/styles\.iconFill,\s*focused \? styles\.fillOn : styles\.fillOff,\s*\{ backgroundColor: c\.primarySoft \}/);
    expect(block("fillOn")).toMatch(/opacity: 1/);
    expect(block("fillOff")).toMatch(/opacity: 0/);
  });

  it("rounds the fill and the bar at less than half their height", () => {
    const wrap = block("iconWrap");
    const fill = block("iconFill");
    const bar = block("bar");
    expect(num(fill, "borderRadius")).toBeGreaterThan(0);
    expect(num(fill, "borderRadius") * 2).toBeLessThan(num(wrap, "height"));
    expect(num(bar, "borderRadius") * 2).toBeLessThan(num(bar, "height"));
  });

  it("the wrap carries no fill of its own", () => {
    expect(block("iconWrap")).not.toMatch(/backgroundColor/);
    expect(src).toMatch(/<View style=\{styles\.iconWrap\}>/);
  });
});

/**
 * THE GROCERY TAB IS NOT HOME AGAIN.
 *
 * "Grocery screen still same hai, uska banner b wohi hai" — it showed the very
 * banners Home had just shown, and its kinds row could fill with kitchens.
 */
describe("grocery tab", () => {
  const market = fs.readFileSync(path.join(PROJECT_ROOT, "src/modules/marketplace/screens/MarketScreen.tsx"), "utf8");

  it("shows its own slides, not Home's banners", () => {
    expect(market).not.toMatch(/useHomeFeed/);
    expect(market).toMatch(/hero=\{NO_BANNERS\}/);
    expect(market).toMatch(/ownSlides=\{slides\}/);
  });

  it("leaves the kitchens to Home", () => {
    expect(market).toMatch(/KITCHEN_TRADES = new Set\(\["food", "restaurant", "bakery"\]\)/);
    expect(market).toMatch(/filter\(\(t\) => !KITCHEN_TRADES\.has\(t\.type\)\)/);
  });

  it("is the hero only as the tab; the pushed list keeps its plain header", () => {
    expect(market).toMatch(/isTab \? \(\s*<>\s*<View style=\{styles\.bleed\}>\s*<HomeHero/);
    expect(market).toMatch(/\{!isTab && \(\s*<View style=\{styles\.header\}>/);
  });
});
