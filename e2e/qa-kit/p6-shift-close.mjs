// Closing an earlier day's shift from the till's banner: nothing counted will
// not close; the drawer counted note by note to what it should hold closes
// with no difference.
import { open } from "./kit.mjs";

const who = process.argv[2] ?? "hina@zariclothing.test";
const qa = await open(who, { password: "Staff-pass-1", stage: "p6-close", har: false });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const flat = (t) => t.replace(/\s+/g, " ").trim();
try {
  const s0 = (await qa.ask("/pos/session")).data;
  out("shift", { opened_on: s0?.opened_on, earlier: s0?.from_an_earlier_day });
  const r = (await qa.ask("/pos/session/report")).data;
  const expected = Number(r.drawer.expected_cash);
  out("should hold", expected);

  await page.goto("/tenant/pos");
  const banner = page.getByTestId("shift-banner");
  await banner.waitFor({ timeout: 30_000 });
  out("banner", flat(await banner.innerText()));
  await banner.getByRole("button", { name: "Close shift" }).click();
  const dlg = page.getByRole("dialog").filter({ hasText: "Counted" });
  await dlg.waitFor();
  await qa.quiet(800);
  const btn = dlg.getByRole("button", { name: "Close shift" });
  out("Close shift enabled with nothing counted", await btn.isEnabled());
  out("says", flat(await dlg.getByTestId("close-shift-uncounted").innerText().catch(() => "(nothing)")));
  out("empty tick offered", await dlg.getByRole("checkbox", { name: /The drawer is empty/ }).count());
  await qa.shot("uncounted");

  let left = expected;
  for (const d of r.denominations) {
    const n = Math.floor(left / d + 1e-9);
    if (n > 0) { await dlg.locator(`input[data-denomination="${d}"]`).fill(String(n)); left = Math.round((left - n * d) * 100) / 100; }
  }
  out("left uncounted (paisa)", left);
  out("empty tick after counting", await dlg.getByRole("checkbox", { name: /The drawer is empty/ }).count());
  out("sheet totals", flat(await dlg.innerText()).match(/Counted.*?(?=Notes|What the machines|Cancel)/)?.[0] ?? "");
  await qa.shot("counted");
  await btn.click();
  await banner.filter({ hasText: /Open a shift/ }).waitFor({ timeout: 20_000 });
  out("banner after", flat(await banner.innerText()));
  const z = (await qa.ask(`/pos/sessions/${s0.id}/z-report`)).data?.session;
  out("closed", { status: z?.status, expected: z?.expected_cash, counted: z?.counted_cash, variance: z?.variance });
  console.log(qa.report());
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(qa.report());
} finally {
  await qa.close();
}
