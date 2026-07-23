/**
 * Print an HTML document (a full page string) via a hidden iframe. Using an
 * iframe — rather than window.open — avoids popup blockers, which matters for
 * AUTO-print (no user gesture fires it), and keeps the till page in front.
 *
 * We wait for any images (e.g. the shop logo on the invoice) to finish loading
 * before calling print(), so they actually appear on the printout, with a hard
 * timeout so a slow/broken image never stalls the receipt.
 */
export function printHtmlDocument(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";

  iframe.onload = () => {
    const win = iframe.contentWindow;
    const doc = win?.document;
    if (!win || !doc) { iframe.remove(); return; }

    let printed = false;
    const go = () => {
      if (printed) return;
      printed = true;
      win.focus();
      win.print();
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
}
