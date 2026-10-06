import { PRODUCT } from "../../common/brand";

/**
 * A test page, on the paper a device says it holds.
 *
 * Printed through the SAME door as a receipt (`printHtmlDocument`), so a test
 * page that comes out right means a receipt will. It used to open its own
 * window with its own `@page { size: 80mm auto }` — which is not CSS, so the
 * test page came out on A4 exactly as the receipts did, and a shopkeeper
 * pressing "Test print" to find out why learned nothing.
 */
export interface TestPageDevice {
  name: string;
  brand?: string | null;
  model?: string | null;
  settings?: { paper_size?: string | null } | null;
}

const escaped = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** The roll a device holds in mm, or null for a sheet. Unset means the common 80mm roll. */
export function deviceRollMm(paper: string | null | undefined): number | null {
  if (paper === "58mm") return 58;
  if (paper === "a4") return null;

  return 80;
}

export function testPageHtml(d: TestPageDevice, now = new Date()): string {
  const roll = deviceRollMm(d.settings?.paper_size);
  const width = roll === 58 ? "48mm" : roll === 80 ? "72mm" : "480px";

  return `<!doctype html><html lang="en"${roll === null ? "" : ` data-roll-mm="${roll}" data-roll-margin-mm="0"`}><head><meta charset="utf-8"><title>Test print</title>
    <style>
      html,body{margin:0;padding:0}
      body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;padding:8px;color:#101828}
      .r{width:${width};max-width:100%;margin:0 auto;font-size:12px;text-align:center}
      h2{font-size:14px;margin:0 0 4px} hr{border:none;border-top:1px dashed #98a2b3;margin:8px 0}
      @media print{@page{size:${roll === null ? "A4" : `${roll}mm 297mm`};margin:0}}
    </style></head><body>
    <div class="r"><h2>${escaped(d.name)}</h2>
    <div>${escaped(d.brand)} ${escaped(d.model)}</div><hr/>
    <div>Test print OK</div><div>${escaped(now.toLocaleString())}</div><hr/>
    <div>${escaped(PRODUCT.name)}</div></div>
    </body></html>`;
}
