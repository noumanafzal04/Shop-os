import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AN ACCEPTED QUOTE BECOMES THE JOB (services #S4), AND A BILL MAY GO ON
 * KHATA (services #S3).
 *
 * A quotation offered Print, Hold on advance, Bill and Cancel — nothing that
 * makes it the work a tailor, printer or laundry was quoted for. The server
 * takes `from_document_id` on a job card now (SaleDocumentTest); this holds
 * the screen to the rule that offers it.
 */
const page = readFileSync(resolve(__dirname, "pages/DocumentDetailPage.tsx"), "utf8");

describe("a quotation's own buttons", () => {
  it("offer Start the job to a trade that runs a job board, on an open quote that has not run out", () => {
    expect(page).toMatch(/const startable = open && !layaway && !job && !doc\.has_lapsed && hasJobBoard\(trade\)/);
    expect(page).toMatch(/\{startable && \(/);
    expect(page).toMatch(/\{ kind: "job_card", from_document_id: doc\.id \}/);
  });

  it("say what the quote became", () => {
    expect(page).toMatch(/const becameJob = heldAs\?\.kind === "job_card"/);
    expect(page).toMatch(/becameJob \? "Taken in as a job" : "Held on advance"/);
  });

  it("let the bill go on khata where the shop, the person and the document allow it", () => {
    expect(page).toMatch(/features\?\.customers\s*&& s\.hasPermission\("sales\.on_credit"\)/);
    expect(page).toMatch(/khata=\{canBillOnKhata && !!doc\.customer_phone\}/);
  });
});
