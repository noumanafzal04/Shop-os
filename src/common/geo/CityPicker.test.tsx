import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * COUNTRY → PROVINCE → CITY, AS ONE CONTROL.
 *
 * 458 cities do not fit one dropdown, so a province narrows them — but a city
 * can still be chosen straight away, and its province follows. The city stays
 * a select labelled "City", which every screen and test already finds.
 */
let countries = [{ id: 167, name: "Pakistan", iso2: "PK", phone_code: "92", currency: "PKR" }];
vi.mock("../api/client", () => ({
  apiGet: async (url: string) => {
    if (url === "/countries") return { data: countries };
    if (url === "/provinces") {
      return {
        data: [
          { id: 3176, country_id: 167, name: "Punjab", type: "province" },
          { id: 3175, country_id: 167, name: "Sindh", type: "province" },
          { id: 3174, country_id: 167, name: "Balochistan", type: "province" },
        ],
      };
    }
    return {
      data: [
        { id: "lhr", name: "Lahore", province_id: 3176, country_id: 167, latitude: 31.5, longitude: 74.3 },
        { id: "mux", name: "Multan", province_id: 3176, country_id: 167, latitude: 30.2, longitude: 71.5 },
        { id: "khi", name: "Karachi", province_id: 3175, country_id: 167, latitude: 24.8, longitude: 67.0 },
        { id: "nas-s", name: "Nasirabad", province_id: 3175, country_id: 167, latitude: 27.4, longitude: 67.9 },
        { id: "nas-b", name: "Nasirabad", province_id: 3174, country_id: 167, latitude: 28.6, longitude: 68.1 },
      ],
    };
  },
}));

import { CityPicker } from "./CityPicker";

function Harness({ start = "" }: { start?: string }) {
  const [city, setCity] = useState(start);
  return (
    <>
      <CityPicker value={city} onChange={(id) => setCity(id)} />
      <output data-testid="chosen">{city}</output>
    </>
  );
}

const show = (start?: string) =>
  render(<QueryClientProvider client={new QueryClient()}><Harness start={start} /></QueryClientProvider>);

const options = (label: string) =>
  Array.from((screen.getByLabelText(label, { selector: "select" }) as HTMLSelectElement).options).map((o) => o.text);

describe("choosing where a shop is", () => {
  it("offers every city until a province narrows it", async () => {
    show();
    await screen.findByRole("option", { name: "Lahore" });

    expect(options("City")).toEqual(expect.arrayContaining(["Lahore", "Multan", "Karachi"]));

    fireEvent.change(screen.getByLabelText("Province", { selector: "select" }), { target: { value: "3175" } });
    expect(options("City")).not.toContain("Lahore");
    expect(options("City")).toContain("Karachi");
  });

  it("fills the province in when a city is chosen straight away", async () => {
    show();
    await screen.findByRole("option", { name: "Lahore" });

    fireEvent.change(screen.getByLabelText("City", { selector: "select" }), { target: { value: "lhr" } });

    expect(screen.getByTestId("chosen").textContent).toBe("lhr");
    expect((screen.getByLabelText("Province", { selector: "select" }) as HTMLSelectElement).value).toBe("3176");
  });

  it("shows a city already chosen under its own province", async () => {
    show("khi");
    await screen.findByRole("option", { name: "Karachi" });

    expect((screen.getByLabelText("Province", { selector: "select" }) as HTMLSelectElement).value).toBe("3175");
    expect((screen.getByLabelText("City", { selector: "select" }) as HTMLSelectElement).value).toBe("khi");
  });

  it("drops a city that is not in the province chosen next", async () => {
    show("lhr");
    await screen.findByRole("option", { name: "Lahore" });

    fireEvent.change(screen.getByLabelText("Province", { selector: "select" }), { target: { value: "3175" } });

    expect(screen.getByTestId("chosen").textContent).toBe("");
  });

  it("says which Nasirabad when both are on the list", async () => {
    show();
    await screen.findByRole("option", { name: "Lahore" });

    expect(options("City")).toEqual(expect.arrayContaining(["Nasirabad (Sindh)", "Nasirabad (Balochistan)"]));
  });

  it("asks for a country only once there is more than one", async () => {
    countries = [{ id: 167, name: "Pakistan", iso2: "PK", phone_code: "92", currency: "PKR" }];
    const one = show();
    await screen.findByRole("option", { name: "Lahore" });
    expect(screen.queryByLabelText("Country", { selector: "select" })).toBeNull();
    one.unmount();

    countries = [...countries, { id: 231, name: "United Arab Emirates", iso2: "AE", phone_code: "971", currency: "AED" }];
    show();
    expect(await screen.findByLabelText("Country", { selector: "select" })).toBeInTheDocument();
  });
});
