/**
 * STUB — structure only. BLOCKED: see docs/DECISIONS.md #2.
 *
 * A slip for the kitchen, and a receipt for the customer.
 *
 * ── Why neither of the existing answers works here ───────────────────
 *
 * The panel prints through the browser's own dialog and kicks the cash
 * drawer over Web Serial (`panel/src/common/escpos.ts`). A phone has
 * neither a print dialog it can drive nor a serial port.
 *
 * Three routes, costed in DECISIONS #2:
 *   A  Bluetooth ESC/POS      real partner-app behaviour, most work
 *   B  Android print / PDF    least work, needs a WiFi/USB printer
 *   C  share a PDF            weakest for a kitchen
 *
 * Whichever is chosen, the SLIP ITSELF should be rendered by the server.
 * A second layout living in a phone is a second thing to keep in step
 * with the paper the panel already prints, and they will drift on the
 * first shop that asks for its logo on the docket.
 */
