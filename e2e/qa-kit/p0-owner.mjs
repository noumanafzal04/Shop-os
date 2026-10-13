// Phase 0 by hand, as the owner and the accounts desk: both still see profit and expenses.
import { open, textOf } from "./kit.mjs";

for (const [who, password] of [["sana@zariclothing.test", "Zari-pass-1"], ["farah@zariclothing.test", "Staff-pass-1"], ["usman@zariclothing.test", "Staff-pass-1"]]) {
  const qa = await open(who, { password, stage: `p0-${who.split("@")[0]}`, har: false });
  try {
    const dash = qa.page.waitForResponse((r) => r.url().includes("/api/v1/dashboard"), { timeout: 30_000 });
    await qa.page.goto("/tenant");
    const d = (await (await dash).json()).data;
    await qa.quiet(1500);
    const main = await textOf(qa.page);
    console.log(who, "| sees", JSON.stringify(d.sees), "| profit", d.today.profit, "| expenses", d.today.expenses,
      "| tiles: Profit", /Today's Profit/.test(main), "Expenses", /Today's Expenses/.test(main), "|", qa.report().split("\n")[0]);
    await qa.shot("dashboard");
  } finally { await qa.close(); }
}
