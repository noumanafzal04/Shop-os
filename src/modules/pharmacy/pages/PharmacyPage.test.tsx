import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * WHO HANDED IT OVER (pharmacy #PH6).
 *
 * The register answered what, how much, which lot and whose prescription —
 * not the regulator's second question: which member of staff gave it out.
 */
vi.mock("../../../components/common/PageMeta", () => ({ default: () => null }));
vi.mock("../../../stores/useCan", () => ({ useCan: () => () => true }));
// One object, as react-query hands back — a fresh one per render never settles.
const register = {
  isLoading: false,
  error: null,
  data: {
    from: "2026-10-01",
    to: "2026-10-28",
    rows: [
      {
        sale_id: "s1", invoice_number: "INV-000008", dispensed_at: "2026-10-27T10:00:00Z",
        drug: "QA Alprax", generic_name: "Alprazolam", strength: "0.5mg", dosage_form: "Tablet",
        schedule: "G", quantity: 1, batches: [], prescription_number: "RX-77",
        patient_name: "Mrs Nasreen Bibi", prescriber_name: "Dr Farooq", customer_phone: null,
        dispensed_by: "Hina",
      },
    ],
  },
};
vi.mock("../hooks/usePharmacy", () => ({
  useDispensingRegister: () => register,
  useRecall: () => ({ data: undefined, isLoading: false, error: null }),
}));

import PharmacyPage from "./PharmacyPage";

describe("the dispensing register", () => {
  it("names the member of staff who handed the medicine over", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <PharmacyPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("columnheader", { name: "Handed over by" })).toBeInTheDocument();
    const row = screen.getByText("QA Alprax").closest("tr") as HTMLElement;
    expect(within(row).getByText("Hina")).toBeInTheDocument();
  });
});
