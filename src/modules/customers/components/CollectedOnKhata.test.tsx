import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import CollectedOnKhata, { type KhataCollections } from "./CollectedOnKhata";

/** Money paid against khata is seen, by method and by whom — and said not to be a sale (L14). */

vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number | string) => `Rs ${Number(n).toLocaleString("en-US")}` }));
vi.mock("../../../common/format/date", () => ({ timeOf: () => "3:15 PM" }));

const day: KhataCollections = {
  total: 2000, count: 2,
  by_method: [{ method: "bank_transfer", total: 1500, count: 1 }, { method: "cash", total: 500, count: 1 }],
  entries: [{ id: "e1", amount: 1500, method: "bank_transfer", reference: "IBFT 77", at: "2026-10-15T10:15:00Z", customer: { id: "c1", name: "Ali Raza", phone: "03000124123" }, taken_by: "Sana" }],
};

const show = (c: KhataCollections, cash = false) =>
  render(<MemoryRouter><CollectedOnKhata collections={c} cashInDrawers={cash} /></MemoryRouter>).container;

describe("collected on khata", () => {
  it("says what came in, how, and that it is not a sale", () => {
    const box = show(day, true);

    expect(box).toHaveTextContent("Collected on khata");
    expect(box).toHaveTextContent("not sales, so not added to them");
    expect(box).toHaveTextContent("The cash is already in the drawers above.");
    expect(box).toHaveTextContent("Rs 2,000");
    expect(box).toHaveTextContent("Transfer Rs 1,500 · 1");
    expect(box).toHaveTextContent("Cash Rs 500 · 1");
  });

  it("names who paid and opens them", () => {
    show(day);

    expect(screen.getByRole("link", { name: "Ali Raza" })).toHaveAttribute("href", "/tenant/customers?q=03000124123");
    expect(screen.getByRole("row", { name: /Ali Raza/ })).toHaveTextContent("Transfer · IBFT 77");
    expect(screen.getByRole("row", { name: /Ali Raza/ })).toHaveTextContent("Sana");
  });

  it("is not there when nothing came in", () => {
    expect(show({ total: 0, count: 0, by_method: [] }).innerHTML).toBe("");
  });
});
