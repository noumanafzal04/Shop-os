/**
 * THE PAGE A ROLL RECEIPT IS PRINTED ON.
 *
 *     "Receipt is set to Thermal 80mm, and the till still prints A4."
 *
 * A roll has a width and no length. CSS can say the first and has no way to
 * say the second: `@page { size: 80mm auto }` is what every receipt template
 * wrote, and it is not CSS — a browser drops it and prints on the printer's
 * default sheet. So the page is made as wide as the roll and exactly as long
 * as THIS receipt, measured here, where the receipt has already been laid
 * out. A two-item sale is a short slip and a forty-item one is a long slip,
 * and neither is an A4 sheet with a column down the middle of it.
 *
 * The template says which roll it is for with `data-roll-mm` on <html>
 * (PrintPaper on the server). No attribute means a sheet, and a sheet's own
 * `@page` is left alone.
 */

const PX_PER_MM = 96 / 25.4;

/** Paper the cutter needs past the last line. A receipt cut through its footer is worse than a centimetre of blank. */
const TAIL_MM = 6;

/** Nothing shorter than this is a page a driver will accept. */
const SHORTEST_MM = 40;

export interface Roll {
  widthMm: number;
  marginMm: number;
}

/** The roll a document says it is for, or null for a sheet. */
export function rollOf(doc: Pick<Document, "documentElement">): Roll | null {
  const width = Number(doc.documentElement.getAttribute("data-roll-mm"));
  if (!Number.isFinite(width) || width <= 0) return null;

  const margin = Number(doc.documentElement.getAttribute("data-roll-margin-mm") ?? 3);

  return { widthMm: width, marginMm: Number.isFinite(margin) && margin >= 0 ? margin : 3 };
}

/**
 * The print rule for a roll holding a receipt this tall.
 *
 * Always two LENGTHS: that is the only form of `size` that means a custom
 * page. The height is rounded UP — a page a millimetre short pushes the last
 * line onto a second slip, which the cutter then separates from the first.
 */
export function rollPageRule(roll: Roll, contentHeightPx: number): string {
  const content = Math.ceil(Math.max(0, contentHeightPx) / PX_PER_MM);
  const height = Math.max(SHORTEST_MM, content + roll.marginMm * 2 + TAIL_MM);

  return `@media print { @page { size: ${roll.widthMm}mm ${height}mm; margin: ${roll.marginMm}mm; } }`;
}

/** The roll width a document string asks for, before it is a document. */
export function rollWidthIn(html: string): number | null {
  const found = /<html[^>]*\sdata-roll-mm="(\d+)"/i.exec(html);

  return found ? Number(found[1]) : null;
}

/**
 * Fit a loaded roll document's page to its own length. Does nothing to a sheet.
 *
 * Appended LAST in <head> so it is the rule that wins over the template's own
 * fallback (as wide as the roll, as long as an A4 sheet).
 */
export function fitRoll(doc: Document): string | null {
  const roll = rollOf(doc);
  if (roll === null) return null;

  const height = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
  const rule = rollPageRule(roll, height);

  doc.getElementById("roll-page")?.remove();
  const style = doc.createElement("style");
  style.id = "roll-page";
  style.textContent = rule;
  doc.head.appendChild(style);

  return rule;
}

/**
 * Print an HTML document (a full page string) via a hidden iframe. Using an
 * iframe — rather than window.open — avoids popup blockers, which matters for
 * AUTO-print (no user gesture fires it), and keeps the till page in front.
 *
 * We wait for any images (e.g. the shop logo on the invoice) to finish loading
 * before calling print(), so they actually appear on the printout, with a hard
 * timeout so a slow/broken image never stalls the receipt.
 *
 * The promise resolves once the job has been HANDED TO the browser. That is
 * the most a web POS can honestly claim: no browser reports back whether paper
 * came out, which is exactly why the till asks the cashier afterwards and logs
 * the answer (see receiptService.printReceipt).
 */
export function printHtmlDocument(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    // OFF the screen, but a real width. A frame of no width lays a 72mm
    // receipt out in no width at all, and a receipt measured that way is the
    // wrong height — which is the one thing a roll's page is cut from.
    const roll = rollWidthIn(html);
    iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${roll === null ? "210mm" : `${roll}mm`};height:10px;border:0;opacity:0;pointer-events:none;`;

    iframe.onload = () => {
      const win = iframe.contentWindow;
      const doc = win?.document;
      if (!win || !doc) { iframe.remove(); reject(new Error("Could not open a print frame")); return; }

      let printed = false;
      const go = () => {
        if (printed) return;
        printed = true;
        try {
          // After the images, so a logo that arrived late is in the height.
          fitRoll(doc);
          win.focus();
          win.print();
          resolve();
        } catch (e) {
          iframe.remove();
          reject(e instanceof Error ? e : new Error("Print failed"));
        }
      };

      // Remove the frame once the print dialog closes (with a long backstop in
      // case onafterprint never fires — e.g. the dialog is dismissed oddly).
      win.onafterprint = () => iframe.remove();
      setTimeout(() => iframe.remove(), 60_000);

      const pending = Array.from(doc.images).filter((im) => !im.complete);
      if (pending.length === 0) { go(); return; }
      let left = pending.length;
      const tick = () => { if (--left <= 0) go(); };
      pending.forEach((im) => { im.addEventListener("load", tick); im.addEventListener("error", tick); });
      setTimeout(go, 2_000); // don't wait forever on a slow logo
    };

    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}
