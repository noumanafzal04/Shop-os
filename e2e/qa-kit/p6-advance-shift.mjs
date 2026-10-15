// Cash taken as an advance needs today's shift where the shop asks for shifts
// (L2): someone with no shift is told so, and card money is never held up.
// Nothing is saved — every sheet is cancelled.
import { open } from "./kit.mjs";

const who = process.argv[2] ?? "hina@zariclothing.test";
const qa = await open(who, { password: "Staff-pass-1", stage: "p6-advance", har: false });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const flat = (t) => t.replace(/\s+/g, " ").trim();
const notice = async (scope) => ((await scope.getByTestId("shift-needed").count()) ? flat(await scope.getByTestId("shift-needed").first().innerText()) : "(no notice)");
try {
  out("shift", (await qa.ask("/pos/session")).data ?? null);

  await page.goto("/tenant/documents");
  await page.getByRole("button", { name: "Hold goods on advance" }).click();
  await page.getByPlaceholder("Search products…").fill("Silk Scarf");
  await page.getByTestId("document-offers").getByRole("button").first().click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const sheet = page.getByRole("dialog").filter({ hasText: "Advance taken" });
  await sheet.waitFor();
  await sheet.getByPlaceholder("03xx-xxxxxxx").fill("03001234567");
  await sheet.getByPlaceholder(/^\d+$/).last().fill("500");
  await qa.quiet(600);
  const hold = sheet.getByRole("button", { name: "Hold the goods" });
  out("hold · cash · notice", await notice(sheet));
  out("hold · cash · button on", await hold.isEnabled());
  await qa.shot("hold-cash");
  await sheet.getByRole("button", { name: "Card", exact: true }).click();
  out("hold · card · notice", await notice(sheet));
  out("hold · card · button on", await hold.isEnabled());
  await sheet.getByRole("button", { name: "Cancel" }).click();

  const docs = (await qa.ask("/sale-documents?per_page=20")).data ?? [];
  const lay = docs.find((d) => d.kind === "layaway" && d.status === "open");
  await page.goto(`/tenant/documents/${lay.id}`);
  await page.getByRole("button", { name: /Take instalment|Take an advance/ }).click();
  const dm = page.getByRole("dialog").filter({ hasText: "still owed" });
  await dm.getByRole("spinbutton").first().fill("100");
  await qa.quiet(400);
  const record = dm.getByRole("button", { name: "Record" });
  out("instalment · cash · notice", await notice(dm));
  out("instalment · cash · button on", await record.isEnabled());
  await qa.shot("instalment-cash");
  await dm.getByRole("button", { name: "Card", exact: true }).click();
  out("instalment · card · notice", await notice(dm));
  out("instalment · card · button on", await record.isEnabled());
  await dm.getByRole("button", { name: "Cancel" }).click();
  console.log(qa.report());
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(qa.report());
} finally {
  await qa.close();
}
