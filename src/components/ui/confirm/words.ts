/**
 * WHAT THE "NO" BUTTON SAYS.
 *
 * A confirmation has a yes and a no, and the no has always said "Cancel".
 * That is fine until the question is itself about cancelling something:
 *
 *     Cancel this tab?            [ Cancel ]  [ Cancel tab ]
 *
 * Two buttons that both say cancel, one of which voids a table's whole order.
 * A waiter reads the first word. So when the yes begins with "Cancel", the no
 * says what it keeps — unless the screen chose its own words, which always win.
 */
export function dismissLabel(opts: { confirmLabel?: string; cancelLabel?: string }): string {
  if (opts.cancelLabel) return opts.cancelLabel;

  return /^cancel\b/i.test(opts.confirmLabel?.trim() ?? "") ? "Keep it" : "Cancel";
}
