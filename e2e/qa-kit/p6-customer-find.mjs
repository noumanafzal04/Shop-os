// Finding a customer already on file from a few letters or digits — at the
// till's Customer box and on the quotation form (L8). Nothing is saved.
import { open } from "./kit.mjs";

const who = process.argv[2] ?? "hina@zariclothing.test";
const qa = await open(who, { password: "Staff-pass-1", stage: "p6-find", har: false });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const flat = (t) => t.replace(/\s+/g, " ").trim();
try {
  qa.step("till");
  await page.goto("/tenant/pos");
  await page.getByRole("button", { name: /^Walk-in$/ }).first().click();
  const dlg = page.getByRole("dialog").filter({ hasText: "Leave blank for a walk-in sale" });
  await dlg.getByPlaceholder("Customer name").fill("Walk");
  const list = dlg.getByTestId("customer-suggestions");
  await list.waitFor({ timeout: 10_000 });
  out("till · suggestions", flat(await list.innerText()));
  await qa.shot("till-suggest");
  await list.getByRole("button").first().click();
  out("till · filled", { name: await dlg.getByPlaceholder("Customer name").inputValue(), phone: await dlg.getByPlaceholder("03xx-xxxxxxx").inputValue() });
  out("till · list gone", await dlg.getByTestId("customer-suggestions").count());
  await dlg.getByRole("button", { name: "Walk-in", exact: true }).click();

  qa.step("quotation form");
  await page.goto("/tenant/documents");
  await page.getByRole("button", { name: "New quotation" }).click();
  await page.getByPlaceholder("Search products…").fill("Silk Scarf");
  await page.getByTestId("document-offers").getByRole("button").first().click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const sheet = page.getByRole("dialog").filter({ hasText: "Save this ticket" });
  await sheet.getByPlaceholder("03xx-xxxxxxx").fill("0300-123");
  const found = sheet.getByTestId("customer-suggestions");
  await found.waitFor({ timeout: 10_000 });
  out("form · suggestions", flat(await found.innerText()));
  await qa.shot("form-suggest");
  await found.getByRole("button").first().click();
  out("form · filled", { name: await sheet.getByPlaceholder("Name").inputValue(), phone: await sheet.getByPlaceholder("03xx-xxxxxxx").inputValue() });
  await sheet.getByRole("button", { name: "Cancel" }).click();
  console.log(qa.report());
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(qa.report());
} finally {
  await qa.close();
}
