// Retiring an item and bringing it back, from its own form: the list says so,
// the till cannot find it, its history is untouched; then it sells again.
import { open } from "./kit.mjs";

const NAME = "QA Walk Biscuit 100g";
const CODE = "8964000111222";
const qa = await open("grocery@loadtest.test", { stage: "p6-item-active", har: false });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const flip = async (want) => {
  await page.goto(`/tenant/products/${id}/edit`);
  const sw = page.getByRole("button", { name: /Still selling this/ });
  await sw.waitFor({ timeout: 20_000 });
  out("covered while loading", await page.getByTestId("item-loading").count());
  await page.getByTestId("item-loading").waitFor({ state: "detached", timeout: 20_000 });
  out("switches named so", await page.getByRole("button", { name: /Still selling this/ }).count());
  out("pressed before", await sw.getAttribute("aria-pressed"));
  if ((await sw.getAttribute("aria-pressed")) !== String(want)) await sw.click();
  out("pressed after", await sw.getAttribute("aria-pressed"));
  await page.getByRole("button", { name: "Save changes" }).click();
  await qa.quiet(1500);
  out("writes", qa.rows.filter((r) => ["PUT", "PATCH", "POST"].includes(r.method)).map((r) => `${r.status} ${r.method} ${r.path} is_active in body: ${(r.sent.match(/"is_active":(true|false)/) ?? ["(not in the first 600 chars)"])[0]}`).slice(-2));
  await page.waitForURL(/\/tenant\/products(\?|$)/, { timeout: 20_000 }).catch(() => {});
  await qa.quiet(800);
};
const listRow = async () => {
  await page.getByPlaceholder("Search name or SKU…").fill(NAME);
  const row = page.getByRole("row").filter({ hasText: NAME });
  await row.waitFor({ timeout: 15_000 });
  return (await row.innerText()).replace(/\s+/g, " ");
};
let id;
page.on("request", (r) => {
  if (r.method() === "PUT" && r.url().includes("/products/")) {
    const body = r.postDataJSON() ?? {};
    out("PUT body", { is_active: body.is_active, keys: Object.keys(body).length });
  }
});
try {
  id = ((await qa.ask(`/products?search=${encodeURIComponent(NAME)}`)).data ?? []).find((p) => p.name === NAME).id;

  qa.step("retire");
  await flip(false);
  out("saved", (await qa.ask(`/products/${id}`)).data.is_active);
  out("list", await listRow());
  const scan = await qa.ask(`/pos/lookup?code=${CODE}`);
  out("till scan", { status: scan.status, found: scan.data?.product?.name ?? scan.data?.name ?? null, message: scan.message });
  out("history kept", ((await qa.ask(`/inventory/movements?product_id=${id}`)).data ?? []).map((m) => `${m.type} ${m.quantity_change} ${m.reason}`));
  await qa.shot("retired");

  qa.step("bring back");
  await flip(true);
  out("saved", (await qa.ask(`/products/${id}`)).data.is_active);
  out("list", await listRow());
  const again = await qa.ask(`/pos/lookup?code=${CODE}`);
  out("till scan", { status: again.status, found: again.data?.product?.name ?? again.data?.name ?? null });
  console.log(qa.report());
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(qa.report());
} finally {
  await qa.close();
}
