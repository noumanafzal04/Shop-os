// Phase 1: what Zari looks like right now, asked of the server as the owner.
// Run before and after each walk; the two files are compared figure by figure.
//   node e2e/qa-kit/p1-state.mjs <name>   → $QA_OUT/state-<name>.json
import fs from "node:fs";
import { open, OUT } from "./kit.mjs";

const name = process.argv[2] ?? "now";
const qa = await open("sana@zariclothing.test", { password: "Zari-pass-1", stage: `state-${name}`, har: false });
const get = async (p) => { const r = await qa.ask(p); if (r.status >= 400) console.log("✗", r.status, p, r.message); return r; };
// A list answer, whatever it is wrapped in; says so when it is not a list at all.
const rows = async (p) => {
  const d = (await get(p)).data;
  if (Array.isArray(d)) return d;
  for (const k of ["data", "items", "sessions", "rows"]) if (Array.isArray(d?.[k])) return d[k];
  console.log(`(not a list) ${p}: keys ${Object.keys(d ?? {}).join(",")}`);
  return [];
};
try {
  const s = {};
  s.places = (await rows("/branches")).map((b) => ({ id: b.id, name: b.name, kind: b.kind ?? b.type, default: b.is_default }));
  const products = await rows("/products?per_page=100");
  s.sized = products.filter((p) => (p.variants ?? []).length).map((p) => ({ id: p.id, name: p.name, price: p.price, sale: p.discount_price, cost: p.cost, sizes: Object.fromEntries(p.variants.map((v) => [v.name, { id: v.id, price: v.price, cost: v.cost, stock: Number(v.stock_quantity) }])) }));
  s.plain = products.filter((p) => !(p.variants ?? []).length).map((p) => ({ id: p.id, name: p.name, price: p.price, stock: p.stock_quantity, type: p.type }));
  s.customers = (await rows("/customers?per_page=50")).map((c) => ({ id: c.id, name: c.name, phone: c.phone, balance: c.balance ?? c.credit_balance }));
  s.suppliers = (await rows("/suppliers?per_page=50")).map((x) => ({ id: x.id, name: x.name, balance: x.balance }));
  s.purchase_orders = (await rows("/purchase-orders?per_page=50")).map((x) => ({ id: x.id, po: x.po_number, status: x.status, total: x.total, received_total: x.received_total, paid: x.amount_paid }));
  s.sessions = (await rows("/pos/sessions?per_page=20")).map((x) => ({ id: x.id, who: x.user?.name ?? x.opened_by_name, status: x.status, float: x.opening_float ?? x.opening_cash, opened: x.opened_at }));
  s.day = (await get("/pos/day")).data;
  s.coupons = (await rows("/coupons")).map((c) => ({ code: c.code, type: c.type, value: c.value, active: c.is_active }));
  s.promotions = (await rows("/promotions")).map((p) => ({ name: p.name, type: p.type, active: p.is_active }));
  s.sales = (await rows("/sales?per_page=50")).map((x) => ({ inv: x.invoice_number, status: x.status, total: x.total, paid: x.amount_paid, method: x.payment_method, customer: x.customer_name }));
  s.summary = (await get("/reports/summary")).data;
  s.cashbook = (await get("/cashbook")).data;
  s.dashboard = (await get("/dashboard")).data?.today;
  fs.writeFileSync(`${OUT}/state-${name}.json`, JSON.stringify(s, null, 1));
  console.log(`places ${s.places.length} · sized ${s.sized.length} · plain ${s.plain.length} · customers ${s.customers.length} · suppliers ${s.suppliers.length} · POs ${s.purchase_orders.length} · sessions ${s.sessions.length} · sales ${s.sales.length} · coupons ${s.coupons.length} · promotions ${s.promotions.length}`);
  console.log(`saved ${OUT}/state-${name}.json`);
} finally { await qa.close(); }
