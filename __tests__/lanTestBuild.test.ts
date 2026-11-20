import { fs, path, PROJECT_ROOT, codeOnly } from "./support/node";
import { apiUrlFor, hostOf, neighbours } from "../src/common/testServer";
import { API_TARGET } from "../src/common/config";

/**
 * A PHONE TEST BUILD OF THE SHOP APP — like the customer app's.
 *
 * `scripts/build-lan-apk.sh` sets API_TARGET to "lan" for one build only; the
 * app then finds the computer running backend/scripts/serve-lan.sh on the
 * same Wi-Fi, or asks for its address. The committed source stays "auto".
 */
const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

describe("the shop app's phone test build", () => {
  it("is committed pointing at the normal server", () => {
    expect(API_TARGET).toBe("auto");
  });

  it("reads a typed address the way the customer app does", () => {
    expect(apiUrlFor("192.168.1.5")).toBe("http://192.168.1.5:8002/api/v1");
    expect(apiUrlFor("http://192.168.1.5:9000/x")).toBe("http://192.168.1.5:9000/api/v1");
    expect(apiUrlFor("not a host")).toBeNull();
    expect(hostOf("http://192.168.1.5:8002/api/v1")).toBe("192.168.1.5:8002");
    expect(neighbours("192.168.1.10").slice(0, 2)).toEqual(["192.168.1.9", "192.168.1.11"]);
  });

  it("asks for the server before asking who is signed in, and shows the screen until found", () => {
    const app = read("App.tsx");
    expect(app.indexOf("connectTestServer()")).toBeGreaterThan(-1);
    expect(app.indexOf("connectTestServer()")).toBeLessThan(app.indexOf("hydrateTokens()"));
    expect(app).toMatch(/LAN_MODE && lanServer !== "connected" \? \(\s*<TestServerScreen \/>/);
  });

  it("the build script flips the target for one build and the gradle flag allows plain http then only", () => {
    const script = fs.readFileSync(path.join(PROJECT_ROOT, "scripts/build-lan-apk.sh"), "utf8");
    expect(script).toMatch(/trap restore EXIT/);
    expect(script).toMatch(/partner-app-\$\{VERSION\}-test\.apk/);
    const gradle = fs.readFileSync(path.join(PROJECT_ROOT, "android/app/build.gradle"), "utf8");
    expect(gradle).toMatch(/if \(project\.hasProperty\("lanTest"\)\)/);
  });
});
