/**
 * WHAT SIGNING OUT LEAVES BEHIND (B50).
 *
 * Saad signed out with a sale still waiting on the till and was told nothing.
 * Nothing was lost — it went the next time somebody from the shop signed in on
 * that device — but a cashier going home believes the till is empty, and
 * whoever clears the browser's data next believes it too. So it is said before
 * the press, in the count the till's own badge uses (sales and shift events).
 */
export function signOutWarning(owed: number): { title: string; message: string; confirmLabel: string; tone: "danger" } {
  const what = owed === 1 ? "1 sale or shift record is" : `${owed.toLocaleString()} sales or shift records are`;

  return {
    title: `${what} still waiting on this till`,
    message:
      "They have not reached the server yet. They stay safe on this device and are sent the next time someone from this shop signs in here with a connection — so do not clear this browser's data before then.",
    confirmLabel: "Sign out anyway",
    tone: "danger",
  };
}
