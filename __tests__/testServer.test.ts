import { answers, apiUrlFor, hostOf, neighbours, scan } from "../src/common/testServer";
import { API_TARGET } from "../src/common/config";
import { PROJECT_ROOT, fs, path } from "./support/node";

/**
 * A PHONE TEST BUILD FINDS ITS SERVER ON ANY WI-FI.
 *
 * The address of the computer changes with the network; nothing in the app
 * may depend on the one it had the day the APK was built.
 */
describe("what a person types", () => {
  it("takes an address however it is typed and fills in the port", () => {
    expect(apiUrlFor("192.168.1.5")).toBe("http://192.168.1.5:8002/api/v1");
    expect(apiUrlFor(" 192.168.1.5:8000 ")).toBe("http://192.168.1.5:8000/api/v1");
    expect(apiUrlFor("http://192.168.1.5:8002/")).toBe("http://192.168.1.5:8002/api/v1");
    expect(apiUrlFor("HTTP://My-Mac.local")).toBe("http://my-mac.local:8002/api/v1");
  });

  it("refuses what is not an address", () => {
    for (const bad of ["", "   ", "hello", "192.168.1.5:99999", "192.168.1.5:0", "a b.c"]) {
      expect([bad, apiUrlFor(bad)]).toEqual([bad, null]);
    }
  });

  it("remembers host and port, not the API path", () => {
    expect(hostOf("http://192.168.1.5:8002/api/v1")).toBe("192.168.1.5:8002");
  });
});

describe("the search of the phone's own network", () => {
  it("asks every other address on it, nearest first", () => {
    const hosts = neighbours("192.168.105.37");

    expect(hosts).toHaveLength(253);
    expect(hosts).not.toContain("192.168.105.37");
    expect(hosts.slice(0, 4)).toEqual(["192.168.105.36", "192.168.105.38", "192.168.105.35", "192.168.105.39"]);
    expect(new Set(hosts).size).toBe(253);
    expect(hosts.every((h) => /^192\.168\.105\.(\d+)$/.test(h) && Number(h.split(".")[3]) >= 1 && Number(h.split(".")[3]) <= 254)).toBe(true);
  });

  it("has nothing to ask without an address of its own", () => {
    expect(neighbours("")).toEqual([]);
    expect(neighbours("fe80::1")).toEqual([]);
  });

  it("finds the computer wherever on the network it is, and stops there", async () => {
    const asked: string[] = [];
    const found = await scan("10.0.0.20", async (url) => {
      asked.push(url);
      return url === "http://10.0.0.201:8002/api/v1";
    });

    expect(found).toBe("http://10.0.0.201:8002/api/v1");
    // Far from the phone, so several batches in — and not one batch further.
    expect(asked.length).toBeLessThan(253);
    expect(asked).toContain("http://10.0.0.19:8002/api/v1");
  });

  it("says so when nothing answers", async () => {
    expect(await scan("10.0.0.20", async () => false)).toBeNull();
  });
});

describe("only OUR server counts", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const replying = (status: number, body: unknown) => {
    globalThis.fetch = jest.fn(async () => ({ ok: status < 400, json: async () => body })) as never;
  };

  it("accepts the health answer that names the app", async () => {
    replying(200, { success: true, data: { app: "Shop", version: "v1" } });
    expect(await answers("http://10.0.0.2:8002/api/v1")).toBe(true);
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe("http://10.0.0.2:8002/api/v1/health");
  });

  it("refuses a router page, an error, or silence", async () => {
    replying(200, "<html>router</html>");
    expect(await answers("http://10.0.0.1:8002/api/v1")).toBe(false);
    replying(500, { success: false });
    expect(await answers("http://10.0.0.1:8002/api/v1")).toBe(false);
    globalThis.fetch = jest.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as never;
    expect(await answers("http://10.0.0.1:8002/api/v1")).toBe(false);
  });
});

describe("a store build never looks", () => {
  it("ships on auto — the lan target is set for one test build and put back", () => {
    // `scripts/build-lan-apk.sh` flips it, builds, and restores. Committed as
    // "lan", every release would hunt the Wi-Fi for a laptop.
    expect(API_TARGET).toBe("auto");
    const script = fs.readFileSync(path.join(PROJECT_ROOT, "scripts/build-lan-apk.sh"), "utf8");
    expect(script).toMatch(/trap restore EXIT/);
    expect(script).toMatch(/assembleRelease -PlanTest/);
  });

  it("lets only a -PlanTest build speak plain http", () => {
    const gradle = fs.readFileSync(path.join(PROJECT_ROOT, "android/app/build.gradle"), "utf8");
    expect(gradle).toMatch(/if \(project\.hasProperty\("lanTest"\)\) \{[\s\S]*?usesCleartextTraffic", "true"/);
  });
});
