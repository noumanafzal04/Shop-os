// Every line of every Zari sale, as the owner — to choose what comes back.
import { open } from "./kit.mjs";
const qa = await open("sana@zariclothing.test", { password: "Zari-pass-1", stage: "p1-lines", har: false });
try {
  const list = (await qa.ask("/sales?per_page=50")).data ?? [];
  for (const s of list) {
    const full = (await qa.ask(`/sales/${s.id}`)).data;
    const who = full.cash_session?.user?.name ?? full.created_by?.name ?? full.cashier?.name ?? "";
    console.log(s.invoice_number, s.status, s.total, s.payment_method, who, "|", (full.items ?? []).map((l) => `${l.product_name}${l.variant_name ? " (" + l.variant_name + ")" : ""} ×${Number(l.quantity)} @${l.unit_price}`).join("; "));
  }
} finally { await qa.close(); }
