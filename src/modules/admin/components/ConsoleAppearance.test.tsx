import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet, apiPut } from "../../../common/api/client";
import { PLATFORM_LOOK, recallTenantTheme } from "../../../common/theme/rememberedTheme";
import { applyTenantTheme, buildRamp } from "../../../common/theme/tenantTheme";
import { ThemeProvider } from "../../../context/ThemeContext";
import { useAuthStore } from "../../../stores/authStore";
import { useConsoleTheme } from "../hooks/useConsoleAppearance";
import { ConsoleAppearance } from "./ConsoleAppearance";

/**
 * THE CONSOLE'S OWN APPEARANCE.
 *
 * A shop could always choose its colour and what its menu is painted in; the
 * platform console could not, and was drawn from a fallback. What is held
 * here is the wiring a screen test cannot be trusted with alone:
 *
 *   the console is PAINTED in what the platform has saved, and that is
 *     remembered under the platform's own name — never a shop's
 *   it is taken off again on the way out
 *   only a super admin is offered the brush; everybody else just wears it
 *   Save sends the three choices, and Reset is "no colour of its own" — null,
 *     not a copy of the house colour
 */
vi.mock("../../../common/api/client", () => ({ apiGet: vi.fn(), apiPut: vi.fn() }));

const EMERALD = "#12b76a";
const root = () => document.documentElement;
const brand = () => root().style.getPropertyValue("--color-brand-500");
const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });
const saved = (look: { console_theme_primary: string | null; console_theme_tint: string; console_theme_sidebar: string }) =>
  vi.mocked(apiGet).mockResolvedValue(envelope(look) as never);

function Console({ canvas = true }: { canvas?: boolean }) {
  useConsoleTheme();

  return canvas ? <ConsoleAppearance /> : null;
}

const mount = (canvas = true) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider>
        <Console canvas={canvas} />
      </ThemeProvider>
    </QueryClientProvider>,
  );

const as = (role: string) => useAuthStore.setState({ user: { role, permissions: [], tenant: null } } as never);

beforeEach(() => {
  localStorage.clear();
  applyTenantTheme({});
  delete root().dataset.sidebar;
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPut).mockReset();
  vi.mocked(apiPut).mockResolvedValue(envelope({}) as never);
  as("super_admin");
});

afterEach(cleanup);

describe("the console is painted in the platform's own look", () => {
  it("wears what was saved, and remembers it under the platform's name", async () => {
    saved({ console_theme_primary: EMERALD, console_theme_tint: "strong", console_theme_sidebar: "dark" });
    // The denominator: before the answer, the page is in the house look.
    expect(brand()).toBe("");

    mount(false);

    await waitFor(() => expect(brand()).toBe(buildRamp(EMERALD)[500]));
    expect(root().dataset.sidebar).toBe("dark");
    expect(apiGet).toHaveBeenCalledWith("/admin/appearance");
    // Back before the first paint on the next reload — and not as any shop's.
    expect(recallTenantTheme(PLATFORM_LOOK)).toEqual({ primary: EMERALD, tint: "strong", sidebar: "dark" });
    expect(recallTenantTheme("some-shop")).toBeNull();
  });

  it("untouched, is the house colour with the menu in it", async () => {
    saved({ console_theme_primary: null, console_theme_tint: "subtle", console_theme_sidebar: "primary" });

    mount(false);

    await waitFor(() => expect(root().dataset.sidebar).toBe("primary"));
    expect(brand()).toBe("");
  });

  it("keeps what this device remembers until the answer arrives", () => {
    localStorage.setItem("shopos-theme", JSON.stringify({ tenant: PLATFORM_LOOK, primary: EMERALD, sidebar: "light" }));
    // An answer that never comes.
    vi.mocked(apiGet).mockReturnValue(new Promise(() => {}) as never);

    mount(false);

    expect(brand()).toBe(buildRamp(EMERALD)[500]);
    expect(root().dataset.sidebar).toBe("light");
  });

  it("is taken off on the way out — the sign-in page is not the console's to dress", async () => {
    saved({ console_theme_primary: EMERALD, console_theme_tint: "subtle", console_theme_sidebar: "dark" });
    const console_ = mount(false);
    await waitFor(() => expect(brand()).not.toBe(""));

    console_.unmount();

    expect(brand()).toBe("");
  });
});

describe("who is offered the brush", () => {
  it("a super admin is", async () => {
    saved({ console_theme_primary: null, console_theme_tint: "subtle", console_theme_sidebar: "primary" });
    mount();

    expect(await screen.findByRole("button", { name: "Open appearance settings" })).toBeInTheDocument();
  });

  it("platform staff are not — they wear it, and are shown no control whose Save can only be refused", async () => {
    as("admin_staff");
    saved({ console_theme_primary: EMERALD, console_theme_tint: "subtle", console_theme_sidebar: "dark" });
    mount();

    // They are painted…
    await waitFor(() => expect(brand()).toBe(buildRamp(EMERALD)[500]));
    // …and offered nothing.
    expect(screen.queryByRole("button", { name: "Open appearance settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
  });
});

describe("what Save sends", () => {
  const open = async () => fireEvent.click(await screen.findByRole("button", { name: "Open appearance settings" }));

  it("the three choices, for everybody", async () => {
    saved({ console_theme_primary: null, console_theme_tint: "subtle", console_theme_sidebar: "primary" });
    mount();
    await open();

    expect(screen.getByText(/Save to apply for everyone on the console/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Emerald" }));
    // Two buttons say Dark: the colour mode, which is this device's, and the
    // sidebar, which is the platform's. The second is the one that is saved.
    fireEvent.click(screen.getAllByRole("button", { name: /Dark/ })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Strong" }));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith("/admin/appearance", {
        console_theme_primary: EMERALD,
        console_theme_tint: "strong",
        console_theme_sidebar: "dark",
      }),
    );
  });

  it("Reset is no colour of its own — null, and the menu back in the brand", async () => {
    saved({ console_theme_primary: EMERALD, console_theme_tint: "strong", console_theme_sidebar: "light" });
    mount();
    await open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Emerald" })).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith("/admin/appearance", {
        console_theme_primary: null,
        console_theme_tint: "subtle",
        console_theme_sidebar: "primary",
      }),
    );
  });

  it("a save that is refused says so, under the button that was pressed", async () => {
    saved({ console_theme_primary: null, console_theme_tint: "subtle", console_theme_sidebar: "primary" });
    vi.mocked(apiPut).mockRejectedValue(new Error("Only a super admin can change how the console looks."));
    mount();
    await open();

    fireEvent.click(screen.getByRole("button", { name: "Emerald" }));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(await screen.findByText("Only a super admin can change how the console looks.")).toBeInTheDocument();
    // …and it does not claim to have saved.
    expect(screen.queryByRole("button", { name: "Saved" })).not.toBeInTheDocument();
  });

  it("nothing is sent until something has changed", async () => {
    saved({ console_theme_primary: null, console_theme_tint: "subtle", console_theme_sidebar: "primary" });
    mount();
    await open();

    expect(screen.getByRole("button", { name: /Saved|Save/ })).toBeDisabled();
    expect(apiPut).not.toHaveBeenCalled();
  });
});
