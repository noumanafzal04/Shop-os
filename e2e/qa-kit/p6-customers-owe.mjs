// L16: the customer list says who owes. Owes column, last paid, filters with
// counts, the dashboard's "Owed to you" opening onto them, Take payment in the
// row, export keeping the filter. Reads only — nothing is paid.
import { open } from "./kit.mjs";

const qa = await open("grocery@loadtest.test", { stage: "p6-customers-owe", har: false });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const flat = (t) => t.replace(/\s+/g, " ").trim();

try {
  const sum = (await qa.ask("/customers/summary")).data;
  out("summary (API)", sum);
  const dash = (await qa.ask("/dashboard")).data?.money_owed?.receivable;
  out("dashboard owed to you (API)", dash);

  qa.step("dashboard → Owed to you");
  await page.goto("/tenant");
  const tile = page.getByRole("link").filter({ hasText: "Owed to you" }).first();
  await tile.waitFor({ timeout: 20_000 });
  out("tile", flat(await tile.innerText()));
  await tile.click();
  await page.waitForURL(/\/tenant\/customers\?show=owes/, { timeout: 10_000 });
  const chips = page.getByTestId("customer-filters");
  await chips.getByRole("button", { name: /^Owe money/ }).and(page.locator("[aria-pressed=true]")).waitFor({ timeout: 10_000 });
  out("chips", flat(await chips.innerText()));
  out("owed line", flat(await page.getByTestId("customers-owed").innerText()));
  await page.locator("tbody tr[data-owes]").first().waitFor({ timeout: 15_000 });
  const rows = await page.locator("tbody tr").evaluateAll((trs) => trs.slice(0, 6).map((tr) => tr.innerText.replace(/\s+/g, " ").trim()));
  out("first rows (owes, most first)", rows);
  out("rows tinted / shown", `${await page.locator("tbody tr[data-owes]").count()} / ${await page.locator("tbody tr").count()}`);
  await qa.shot("owes");

  qa.step("over / near limit");
  await chips.getByRole("button", { name: /^Over \/ near limit/ }).click();
  await qa.quiet(1200);
  out("limit rows", await page.locator("tbody tr").evaluateAll((trs) => trs.slice(0, 4).map((tr) => tr.innerText.replace(/\s+/g, " ").trim())));
  await qa.shot("limit");

  qa.step("advance held");
  await chips.getByRole("button", { name: /^Advance held/ }).click();
  await qa.quiet(1200);
  out("advance rows", await page.locator("tbody tr").evaluateAll((trs) => trs.slice(0, 3).map((tr) => tr.innerText.replace(/\s+/g, " ").trim())));

  qa.step("Take payment from the row opens the card");
  await chips.getByRole("button", { name: /^Owe money/ }).click();
  await qa.quiet(1200);
  const first = page.locator("tbody tr[data-owes]").first();
  await first.getByRole("button", { name: "Take payment" }).click();
  const box = page.getByRole("dialog").getByTestId("khata-box");
  await box.waitFor({ timeout: 10_000 });
  out("card opened at", flat(await box.getByTestId("khata-standing").innerText()));
  await page.keyboard.press("Escape");

  qa.step("export keeps the filter");
  const dl = page.waitForEvent("download", { timeout: 20_000 });
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await dl;
  const csv = await (await import("node:fs")).promises.readFile(await file.path(), "utf8");
  const lines = csv.trim().split("\n");
  const balances = lines.slice(1).map((l) => Number(l.split(",")[4] ?? 0));
  out("export", { rows: lines.length - 1, every_row_owes: balances.every((b) => b > 0), owing_count: sum?.owed?.accounts });

  qa.step("All");
  await chips.getByRole("button", { name: /^All/ }).click();
  await qa.quiet(1200);
  out("all: tinted / shown", `${await page.locator("tbody tr[data-owes]").count()} / ${await page.locator("tbody tr").count()}`);
  await qa.shot("all");

  console.log(qa.report());
} catch (e) {
  await qa.shot("failed");
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await qa.close?.();
}
