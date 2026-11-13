import React from "react";
import { FlatList, Text } from "react-native";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * THE HOME SCREEN: ASKED ONCE, FEATURED FIRST, AND IT SCROLLS ON.
 *
 * Three things the screen got wrong, asked of the MOUNTED screen rather than
 * of its source, because each one was a correct-looking line:
 *
 *   - `useHomeFeed(pin)` ran before the remembered place was read back, so
 *     every cold start asked for the whole city and then for the street;
 *   - "All shops" drew the twelve shops the home call carried and stopped;
 *   - the paid row did not exist.
 */
type Shop = { slug: string; business_name: string; is_featured?: boolean };

const shop = (n: number, over: Partial<Shop> = {}): Shop => ({
  slug: `shop-${n}`,
  business_name: `Shop ${n}`,
  ...over,
});

let mockFeatured: Shop[] = [];
/** page → [shops, last_page] */
let mockPages: Record<number, [Shop[], number]> = {};

jest.mock("../src/common/api/client", () => ({
  configureAuth: jest.fn(),
  configureApi: jest.fn(),
  apiGet: jest.fn((url: string, opts?: { params?: Record<string, unknown> }) => {
    if (/\/marketplace\/home/.test(url)) {
      return Promise.resolve({
        data: { featured: mockFeatured, banners: [], nearby: [], top_rated: [], deals: [], business_types: [] },
      });
    }
    if (/\/marketplace\/shops$/.test(url)) {
      const page = Number(opts?.params?.page ?? 1);
      const [rows, last] = mockPages[page] ?? [[], 1];

      return Promise.resolve({
        data: rows,
        meta: { pagination: { current_page: page, last_page: last, per_page: 10, total: 0 } },
      });
    }
    if (/service-area/.test(url)) return Promise.resolve({ data: { zones_drawn: false, served: true, zone: null } });

    return Promise.resolve({ data: null });
  }),
  apiPost: jest.fn(() => Promise.resolve({ data: null })),
  apiPut: jest.fn(() => Promise.resolve({ data: null })),
  apiPatch: jest.fn(() => Promise.resolve({ data: null })),
  apiDelete: jest.fn(() => Promise.resolve({ data: null })),
  api: { get: jest.fn(), post: jest.fn() },
}));

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() }),
  useRoute: () => ({ params: {} }),
  useIsFocused: () => true,
}));

// The drawer is its own tested surface (edgeSwipe); here it is furniture.
jest.mock("../src/navigation/SideMenu", () => ({ SideMenu: () => null }));

import { apiGet } from "../src/common/api/client";
import { CustomerHomeScreen } from "../src/modules/marketplace/screens/CustomerHomeScreen";
import { useLocationStore } from "../src/stores/locationStore";
import { ThemeProvider } from "../src/theme";

const calls = (re: RegExp) =>
  (apiGet as jest.Mock).mock.calls.filter(([url]) => re.test(url)).map(([, opts]) => opts?.params ?? {});

const textOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((x): x is string => typeof x === "string")
    .join(" | ");

/** The page's own list — the one that pages, not a sideways rail inside it. */
const pageList = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(FlatList).find((l) => typeof l.props.onEndReached === "function")!;

// React Query hands results to the screen on a timer tick, not a microtask.
const flush = () => ReactTestRenderer.act(async () => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setTimeout(() => r(), 5));
});

let release: () => void = () => {};
let client: QueryClient;
let tree: ReactTestRenderer.ReactTestRenderer | null = null;

/** The pin as a cold start finds it: nothing yet, read back from storage on cue. */
function coldStart() {
  useLocationStore.setState({
    status: "idle", lat: null, lng: null, city: null, label: null, restored: false,
    detect: jest.fn(async () => {}),
    hydrate: jest.fn(
      () => new Promise<boolean>((done) => {
        release = () => {
          useLocationStore.setState({
            status: "located", lat: 31.5204, lng: 74.3587, city: { id: "lhr", name: "Lahore" } as never,
            label: "Gulberg", restored: true,
          });
          done(true);
        };
      }),
    ),
  });
}

async function render() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}
      >
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <CustomerHomeScreen />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
  });

  return tree!;
}

async function settle() {
  await ReactTestRenderer.act(async () => release());
  await flush();
}

beforeEach(() => {
  (apiGet as jest.Mock).mockClear();
  mockFeatured = [];
  mockPages = { 1: [[shop(1), shop(2)], 1] };
  coldStart();
});

afterEach(async () => {
  if (tree) await ReactTestRenderer.act(() => tree!.unmount());
  tree = null;
  client.clear();
});

describe("a cold start asks once, with the pin", () => {
  it("asks nothing while the remembered place is still being read", async () => {
    await render();

    expect(calls(/\/marketplace\/home/)).toHaveLength(0);
    expect(calls(/\/marketplace\/shops$/)).toHaveLength(0);
  });

  it("then asks each list exactly once, at the street", async () => {
    await render();
    await settle();

    const home = calls(/\/marketplace\/home/);
    expect(home).toHaveLength(1);
    expect(home[0]).toMatchObject({ lat: 31.5204, lng: 74.3587, city_id: "lhr" });

    const shops = calls(/\/marketplace\/shops$/);
    expect(shops).toHaveLength(1);
    // The cards carry their items, ten at a time, nearest first.
    expect(shops[0]).toMatchObject({ lat: 31.5204, lng: 74.3587, previews: 1, per_page: 10, page: 1 });
  });
});

describe("the paid row", () => {
  it("heads the shops and labels every featured card", async () => {
    mockFeatured = [shop(7, { business_name: "Lahori Karahi", is_featured: true })];
    mockPages = { 1: [[shop(1), shop(7, { business_name: "Lahori Karahi", is_featured: true })], 1] };
    await render();
    await settle();

    const text = textOf(tree!);
    expect(text).toContain("Lahori Karahi");
    // The heading, and the tag on the rail card. (The list card below is
    // windowed by FlatList, so the tags counted are the ones it drew.)
    const tags = tree!.root.findAll((n) => typeof n.type !== "string" && n.props?.accessibilityLabel === "Featured shop");
    expect(tags.length).toBeGreaterThanOrEqual(1);
    expect(text.indexOf("Featured")).toBeLessThan(text.indexOf("All shops"));
  });

  it("is not drawn at all when nobody has paid", async () => {
    await render();
    await settle();

    expect(textOf(tree!)).not.toMatch(/\bFeatured\b/);
  });
});

describe("all shops scrolls on", () => {
  beforeEach(() => {
    mockPages = {
      1: [Array.from({ length: 10 }, (_, i) => shop(i + 1)), 2],
      // Shop 10 again: one opened between the two reads and pushed it down.
      2: [[shop(10), ...Array.from({ length: 9 }, (_, i) => shop(i + 11))], 2],
    };
  });

  it("asks for the next page once however often the end is reached, and draws each shop once", async () => {
    await render();
    await settle();
    expect(pageList(tree!).props.data).toHaveLength(10);

    await ReactTestRenderer.act(async () => {
      pageList(tree!).props.onEndReached();
      pageList(tree!).props.onEndReached();
    });
    await flush();

    expect(calls(/\/marketplace\/shops$/).map((p) => p.page)).toEqual([1, 2]);
    const slugs = pageList(tree!).props.data.map((s: Shop) => s.slug);
    expect(slugs).toHaveLength(19);
    expect(new Set(slugs).size).toBe(19);
  });

  it("stops at the last page and says so", async () => {
    await render();
    await settle();
    await ReactTestRenderer.act(async () => pageList(tree!).props.onEndReached());
    await flush();
    await ReactTestRenderer.act(async () => pageList(tree!).props.onEndReached());
    await flush();

    expect(calls(/\/marketplace\/shops$/).map((p) => p.page)).toEqual([1, 2]);
    expect(textOf(tree!)).toContain("You've seen every shop near you");
  });
});
