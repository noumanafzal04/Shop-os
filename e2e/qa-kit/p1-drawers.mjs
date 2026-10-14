// Every open drawer's own account of itself, the cashbook's today, and stock of named sizes.
import { open } from "./kit.mjs";
const qa = await open("sana@zariclothing.test", { password: "Zari-pass-1", stage: "p1-drawers", har: false });
try {
  const sessions = (await qa.ask("/pos/sessions?per_page=20")).data;
  const list = Array.isArray(sessions) ? sessions : sessions?.data ?? [];
  for (const s of list) {
    const z = (await qa.ask(`/pos/sessions/${s.id}/z-report`)).data;
    const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && k in o).map((k) => [k, o[k]]));
    console.log("DRAWER", s.user?.name, s.status, JSON.stringify(pick(z?.summary ?? z, ["opening_float", "cash_sales", "cash_refunds", "refunds", "cash_in", "cash_out", "expected_cash", "expected", "sales_total", "sales_count", "returns_total"])).slice(0, 400));
  }
  const cb = (await qa.ask("/cashbook")).data;
  const today = (cb.days ?? []).find((d) => d.date === "2026-10-13");
  console.log("CASHBOOK totals", JSON.stringify(cb.totals).slice(0, 300));
  console.log("CASHBOOK today", JSON.stringify(today).slice(0, 600));
  const ids = { Teal: null, "White / S": null };
  for (const p of (await qa.ask("/products?per_page=100")).data ?? []) for (const v of p.variants ?? []) if (process.argv.slice(2).includes(v.name)) console.log("STOCK", p.name, v.name, v.stock_quantity);
} finally { await qa.close(); }
