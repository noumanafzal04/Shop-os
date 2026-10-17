/**
 * WHY A SCREEN DID NOT OPEN (B44).
 *
 * A screen somebody may not use, typed in or followed from an old link, sent
 * them to the dashboard and said nothing — so it read as a broken link, or as
 * the dashboard being the screen they asked for. The gates now say which
 * screen it was and why, on the way home, and the home screen says it once.
 */
type RefusedWhy = "permission" | "module";

interface Refused {
  path: string;
  why: RefusedWhy;
}

/** What a gate hands to the screen it sends somebody to. */
export const refusedState = (path: string, why: RefusedWhy): { refused: Refused } => ({ refused: { path, why } });

/** The refusal a navigation carried, if it carried one. */
export function refusedFrom(state: unknown): Refused | null {
  const refused = (state as { refused?: Partial<Refused> } | null)?.refused;
  if (!refused || typeof refused.path !== "string") return null;

  return { path: refused.path, why: refused.why === "module" ? "module" : "permission" };
}

/** "/tenant/stock-transfers/new" → "Stock transfers": the screen's own segment, in words. */
function screenName(path: string): string {
  const segment = path.replace(/^\/(tenant|admin)\/?/, "").split(/[/?#]/)[0] ?? "";
  const words = decodeURIComponent(segment).replace(/[-_]+/g, " ").trim();

  return words === "" ? "That screen" : words.charAt(0).toUpperCase() + words.slice(1);
}

/** What the person is told: which screen, why, and what they can do about it. */
export function refusedWords({ path, why }: Refused): { title: string; message: string } {
  const name = screenName(path);

  return why === "module"
    ? { title: `${name} is not part of this shop`, message: "It is not switched on for this business. Ask the owner if you need it." }
    : { title: `${name} is not open to you`, message: "Your login does not include it. Ask the owner to give you access if your work needs it." };
}
