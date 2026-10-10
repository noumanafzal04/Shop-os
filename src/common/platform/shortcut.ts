/**
 * THE KEYS THAT OPEN SEARCH, as this machine's keyboard prints them.
 *
 * The header said "⌘ K" to everybody. A shop's counter is a Windows PC with
 * no ⌘ on it, so the hint named a key that was not there — and Ctrl+K, which
 * has always worked, was a shortcut nobody was told about.
 */
export function onAMac(platform?: string): boolean {
  const what = platform ?? (typeof navigator === "undefined" ? "" : `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`);

  return /Mac|iPhone|iPad|iPod/i.test(what);
}

export function searchKeys(platform?: string): string[] {
  return onAMac(platform) ? ["⌘", "K"] : ["Ctrl", "K"];
}
