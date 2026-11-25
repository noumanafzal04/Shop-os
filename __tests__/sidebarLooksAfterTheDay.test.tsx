import React from "react";
import { Text } from "react-native";
import ReactTestRenderer from "react-test-renderer";
import { ReceiptIcon, GearIcon } from "@cartze/core/ui/icons";
import { ThemeProvider } from "@cartze/core/theme/ThemeProvider";
import { AppDrawer, type DrawerSection } from "../src/common/components/AppDrawer";
import { fs, path, PROJECT_ROOT } from "./support/node";

jest.mock("react-native-gesture-handler", () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const k of ["runOnJS", "activeOffsetX", "failOffsetY", "onStart", "onUpdate", "onEnd", "onFinalize"]) chain[k] = self;
  return {
    Gesture: { Pan: () => chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

/**
 * THE SIDEBAR ANSWERS THE SHOP'S FIRST QUESTION AND LEADS TO THE DAY.
 *
 * "partner app ki sidebar b achi kro… easy to use ho": the panel opens on the
 * shop with its status (taking orders, or busy until when), puts Orders /
 * Sales / Money first with the waiting count on Orders, and says which build
 * is installed under Sign out.
 */

const sections = (waiting: number): DrawerSection[] => [
  { title: "Today", items: [{ key: "orders", label: "Orders", icon: ReceiptIcon, badge: waiting, onPress: jest.fn() }] },
  { title: "Shop", items: [{ key: "shop", label: "Shop settings", icon: GearIcon, onPress: jest.fn() }] },
];

async function render(props: Partial<React.ComponentProps<typeof AppDrawer>> = {}) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <AppDrawer open onClose={jest.fn()} title="Lahori Karahi House" subtitle="Imran" sections={sections(0)} {...props} />
      </ThemeProvider>,
    );
  });
  return tree;
}

const words = (t: ReactTestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Text).map((n) => [n.props.children].flat().join(""));

describe("the sidebar", () => {
  it("says whether the shop is taking orders, at the top", async () => {
    const t = await render({ status: { label: "Busy · back 5:30 pm", tone: "busy" } });
    expect(words(t)).toContain("Busy · back 5:30 pm");
    expect(words(t).indexOf("Busy · back 5:30 pm")).toBeLessThan(words(t).indexOf("Orders"));
    await ReactTestRenderer.act(() => t.unmount());
  });

  it("shows the orders waiting as a count on Orders, and nothing when none wait", async () => {
    const busy = await render({ sections: sections(3) });
    expect(words(busy)).toContain("3");
    expect(busy.root.findAll((n) => n.props.accessibilityLabel === "Orders, 3 waiting").length).toBeGreaterThan(0);
    await ReactTestRenderer.act(() => busy.unmount());

    const calm = await render({ sections: sections(0) });
    expect(words(calm)).not.toContain("0");
    await ReactTestRenderer.act(() => calm.unmount());
  });

  it("says which build is installed", async () => {
    const t = await render({ version: "True Serve Partner · v1.1.0" });
    expect(words(t)).toContain("True Serve Partner · v1.1.0");
    await ReactTestRenderer.act(() => t.unmount());
  });

  it("leads with the day: Today before the shop's settings, Orders carrying the waiting count", () => {
    const host = fs.readFileSync(path.join(PROJECT_ROOT, "src/common/components/DrawerHost.tsx"), "utf8");
    expect(host).toMatch(/title: "Today", items: today/);
    expect(host.indexOf('title: "Today"')).toBeLessThan(host.indexOf('title: "Shop"'));
    expect(host).toMatch(/badge: waiting,\s*onPress: toOrders\("OrdersQueue"\)/);
    expect(host).toMatch(/status=\{status\}/);
  });
});
