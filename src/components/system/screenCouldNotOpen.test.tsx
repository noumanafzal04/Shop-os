import { lazy, Suspense } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { ScreenCouldNotOpen } from "./ScreenCouldNotOpen";
import { useConnectionStore } from "../../stores/connectionStore";

/**
 * A SCREEN THAT COULD NOT OPEN SAYS SO (offline #OF4).
 *
 * Offline, Take an order on a device that had never opened it was a white
 * page: the screen's download failed and nothing in the panel caught it.
 */
const failedDownload = () =>
  lazy(() => Promise.reject(new Error("Failed to fetch dynamically imported module: http://localhost:5177/src/modules/orders/pages/TakeOrderPage.tsx")));

function shop(Broken: ReturnType<typeof failedDownload>) {
  return render(
    <MemoryRouter initialEntries={["/tenant/orders/take"]}>
      <Link to="/tenant/sales">Sales</Link>
      <ScreenCouldNotOpen>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/tenant/orders/take" element={<Broken />} />
            <Route path="/tenant/sales" element={<p>The sales list</p>} />
          </Routes>
        </Suspense>
      </ScreenCouldNotOpen>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  useConnectionStore.setState({ online: true, reachable: true });
});

describe("a screen that could not open", () => {
  it("offline, says it is not saved on this device and points at the till", async () => {
    useConnectionStore.setState({ online: false, reachable: false });
    shop(failedDownload());

    expect(await screen.findByRole("alert")).toHaveTextContent("This screen is not saved on this device yet");
    expect(screen.getByRole("link", { name: "Go to the till" })).toHaveAttribute("href", "/tenant/pos");
  });

  it("online, after an update, asks for a reload", async () => {
    shop(failedDownload());

    expect(await screen.findByRole("alert")).toHaveTextContent("needs a fresh copy of the app");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Go to the till" })).toBeNull();
  });

  it("failed offline and the line comes back: says so — it does not blame an update (#OF7)", async () => {
    useConnectionStore.setState({ online: false, reachable: false });
    shop(failedDownload());
    await screen.findByRole("alert");

    act(() => useConnectionStore.setState({ online: true, reachable: true }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The internet is back");
    expect(alert).not.toHaveTextContent("updated");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("belongs to the screen it happened on — the next screen opens", async () => {
    shop(failedDownload());
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("link", { name: "Sales" }));

    expect(await screen.findByText("The sales list")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is around every layout's screens, so the sidebar stays", () => {
    for (const layout of ["AppLayout.tsx", "WorkScreenLayout.tsx"]) {
      const source = readFileSync(resolve(__dirname, "../../layout", layout), "utf8");
      expect(source, layout).toMatch(/<ScreenCouldNotOpen>\s*<Outlet \/>\s*<\/ScreenCouldNotOpen>/);
    }
  });
});
