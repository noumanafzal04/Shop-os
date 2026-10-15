// "Add quote" on Quotations & advances (the user, 2026-10-15): a quotation
// started from its own screen, items picked there, saved with the same form
// the till uses — and a layaway with an advance the same way.
import { open } from "./kit.mjs";

const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);

const qa = await open("sana@zariclothing.test", { password: "Zari-pass-1", stage: "p5-new-quote" });
const { page } = qa;
try {
  qa.step("the screen offers it");
  await page.goto("/tenant/documents");
  await qa.quiet(1500);
  out("buttons", { quote: await page.getByRole("button", { name: "New quotation" }).count(), hold: await page.getByRole("button", { name: "Hold goods on advance" }).count() });
  const before = (await qa.ask("/sale-documents?kind=quotation&status=open")).data?.length ?? 0;

  qa.step("pick two items");
  await page.getByRole("button", { name: "New quotation" }).click();
  const sheet = page.getByRole("dialog").filter({ hasText: "New quotation" });
  out("Next before any item", await sheet.getByRole("button", { name: "Next" }).isEnabled());
  await sheet.getByPlaceholder("Search products…").fill("Dupatta");
  await qa.quiet(1200);
  const offers = sheet.getByTestId("document-offers").getByRole("button").filter({ hasNot: page.locator("[disabled]") });
  const first = (await offers.first().innerText()).split("\n")[0];
  await offers.first().click();
  await sheet.getByRole("button", { name: `One more ${first}` }).click();
  await qa.quiet(600);
  out("Next with two on it", await sheet.getByRole("button", { name: "Next" }).isEnabled());
  out("lines", (await sheet.getByTestId("document-lines").innerText()).replace(/\s+/g, " ").slice(0, 160));
  await qa.shot("picked");

  qa.step("save it with the till's form");
  await sheet.getByRole("button", { name: "Next" }).click();
  const form = page.getByRole("dialog").last();
  await form.getByPlaceholder("Name").fill("QA Walk Quote Customer");
  await form.getByRole("button", { name: "Save quotation" }).click();
  await qa.quiet(2500);
  const after = (await qa.ask("/sale-documents?kind=quotation&status=open")).data ?? [];
  const made = after.find((d) => d.customer_name === "QA Walk Quote Customer");
  out("saved", made ? { number: made.number, total: made.total, lines: made.items?.length, open_before: before, open_after: after.length } : "(not saved)");
  out("POST /sale-documents", qa.rows.filter((r) => r.method === "POST" && r.path === "/sale-documents").map((r) => r.status));
  out("dialogs left open", await page.getByRole("dialog").count());
  out("list now shows", (await page.getByRole("row").filter({ hasText: "QA Walk Quote Customer" }).count()) > 0 ? "the new quotation" : "(not in view)");
  await qa.shot("after-save");

  qa.step("hold goods on advance, Hold pressed twice fast");
  const layBefore = (await qa.ask("/sale-documents?kind=layaway&status=open")).data?.length ?? 0;
  await page.getByRole("button", { name: "Hold goods on advance" }).click();
  const hold = page.getByRole("dialog").filter({ hasText: "Hold goods on advance" });
  await hold.getByPlaceholder("Search products…").fill("Dupatta");
  await qa.quiet(1200);
  await hold.getByTestId("document-offers").getByRole("button").filter({ hasNot: page.locator("[disabled]") }).first().click();
  await hold.getByRole("button", { name: "Next" }).click();
  const lay = page.getByRole("dialog").last();
  await lay.getByPlaceholder("Name").fill("QA Walk Layaway");
  await lay.getByPlaceholder("03xx-xxxxxxx").fill("03001234567");
  await lay.locator("input[type=number]").first().fill("500");
  await lay.getByRole("button", { name: /^Card/ }).click().catch(() => {});
  await lay.getByRole("button", { name: "Hold the goods" }).dblclick();
  await qa.quiet(2500);
  const layAfter = (await qa.ask("/sale-documents?kind=layaway&status=open")).data ?? [];
  out("layaways", { before: layBefore, after: layAfter.length, mine: layAfter.filter((d) => d.customer_name === "QA Walk Layaway").map((d) => ({ n: d.number, paid: d.deposit_paid })) });
  out("POSTs for it", qa.rows.filter((r) => r.phase.startsWith("hold") && r.method === "POST" && r.path === "/sale-documents").map((r) => r.status));
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 400));
  await qa.shot("stopped");
} finally {
  console.log(qa.report());
  await qa.close();
}
