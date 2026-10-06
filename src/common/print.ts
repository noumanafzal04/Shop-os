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

/** The roll's margin a document string asks for (3mm when it does not say). */
export function rollMarginIn(html: string): number {
  const found = /<html[^>]*\sdata-roll-margin-mm="(\d+)"/i.exec(html);

  return found ? Number(found[1]) : 3;
}

/**
 * How wide the frame a roll document is MEASURED in has to be.
 *
 * The paper's width less its two margins — the width the words will actually
 * have on the page. The first version laid the document out at the full
 * width of the roll, on the theory that the printed layout is the wider of
 * the two and so wraps less. For the receipt that is true. For the kitchen
 * ticket it is backwards: its lines are large and nearly as wide as the
 * paper, the printed page is eight millimetres narrower than the screen, and
 * "1× Malai Boti Half #9" that fits on one line on screen takes two on paper.
 * The page was cut for the shorter layout and the ticket came out on two
 * slips, the last modifier alone on the second.
 */
export function measuringWidthMm(rollMm: number, marginMm: number): number {
  return Math.max(20, rollMm - marginMm * 2);
}

/**
 * A document that prints ITSELF when it loads.
 *
 * The kitchen ticket carried `onload="window.print()"`, from when it was
 * opened in a tab of its own. Printed through this door it fired first — on
 * the fallback page, before the page had been fitted — and the fitted print
 * came second. One press, two dialogs. The door decides when to print.
 */
export function withoutSelfPrint(html: string): string {
  return html.replace(/\sonload\s*=\s*(["'])\s*window\.print\(\)\s*;?\s*\1/gi, "");
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

  // Measured the way it will be PRINTED: a template that pins its own width
  // for the screen (`body { width: 80mm }`) lets go of it in print, so it is
  // let go of here too — or the words are measured on a wider line than the
  // paper gives them.
  const release = doc.createElement("style");
  release.textContent = "html, body { width: auto !important; min-width: 0 !important; max-width: none !important; }";
  doc.head.appendChild(release);
  const height = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
  release.remove();
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
/**
 * One print at a time.
 *
 * A restaurant's counter sale prints the customer's receipt AND the kitchen's
 * ticket. Both were started together, and a browser shows one print window at
 * a time: in Chrome the second `print()` while the first window is up is
 * simply dropped, so one of the two papers silently never appeared. Each job
 * now waits for the one before it to be dealt with.
 */
let queue: Promise<void> = Promise.resolve();

/** print() took at least this long: it was blocking, and the window is closed. */
const BLOCKED_FOR_MS = 400;

/** print() returned at once and nothing has said the window closed. Move on. */
const NO_SIGNAL_MS = 1_500;

export function printHtmlDocument(html: string): Promise<void> {
  const job = queue.then(() => printNow(withoutSelfPrint(html)));
  // A failed print must not jam every print after it.
  queue = job.then(() => undefined, () => undefined);

  return job;
}

function printNow(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    // OFF the screen, but a real width — the width the words will have on the
    // paper. See measuringWidthMm.
    const roll = rollWidthIn(html);
    const width = roll === null ? "210mm" : `${measuringWidthMm(roll, rollMarginIn(html))}mm`;
    iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${width};height:10px;border:0;opacity:0;pointer-events:none;`;

    iframe.onload = () => {
      const win = iframe.contentWindow;
      const doc = win?.document;
      if (!win || !doc) { iframe.remove(); reject(new Error("Could not open a print frame")); return; }

      let printed = false;
      let settled = false;
      // "Dealt with": the window has closed (or will never say so). Only then
      // may the next job start.
      const done = () => {
        if (settled) return;
        settled = true;
        iframe.remove();
        resolve();
      };

      const go = () => {
        if (printed) return;
        printed = true;
        try {
          // After the images, so a logo that arrived late is in the height.
          fitRoll(doc);
          win.onafterprint = done;
          win.focus();
          const asked = performance.now();
          win.print();
          // In Chrome and Edge — the browsers a till runs in — print() does
          // not return until the window is closed, so by this line the job
          // has been dealt with and the next may start.
          //
          // Where it returns at once (Safari), `afterprint` is the signal,
          // and the short wait below is only for a browser that never sends
          // one: a queue that waited for ever would lose every print after
          // the first, which is worse than two windows asking at once.
          if (performance.now() - asked > BLOCKED_FOR_MS) done();
          else setTimeout(done, NO_SIGNAL_MS);
        } catch (e) {
          iframe.remove();
          reject(e instanceof Error ? e : new Error("Print failed"));
        }
      };

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
