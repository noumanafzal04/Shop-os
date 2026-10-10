/** Where one module's add-on price can apply — see ModulePackages::reach(). */
export interface AddOnReach {
  /** The active plans on which it would be an add-on, for a trade that usually takes it. */
  plans: string[];
  /** How many shops have it as an add-on today. */
  shops: number;
  /** The first few of those shops, by name. Absent from a server older than this. */
  named?: string[];
}

export interface ReachSaid {
  /**
   * `never`: a price here is charged to nobody.
   * `somewhere`: it is an add-on on plans that are on offer.
   * `anyway`: every plan on offer includes it, and somebody has it past their plan all the same.
   */
  kind: "never" | "somewhere" | "anyway";
  says: string;
}

/**
 * Named when every one of them can be — "Alpha", "Alpha and Bravo" — and
 * counted when they cannot: three names and "…and 10 more" is a paragraph
 * under a price box, and past a handful it is the number that matters.
 */
function who(reach: AddOnReach): { names: string; one: boolean } {
  const named = reach.named ?? [];
  const one = reach.shops === 1;

  if (named.length !== reach.shops) return { names: `${reach.shops.toLocaleString()} ${one ? "shop" : "shops"}`, one };

  return { names: named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`, one };
}

/**
 * WHERE A PRICE TYPED HERE WILL EVER BE CHARGED, in a line under the box.
 *
 * The price list gave every module the same box, and the person who typed
 * Rs 25,000 beside Products and saw no bill change had no way to learn why
 * from the screen. It says so now, per module, from the plans and the shops
 * as they stand.
 *
 * Three answers, and the third is the one the first version of this did not
 * have. It read "in every plan" as "charged to nobody" — and said so about
 * Products on a database where a business that only keeps books had been
 * given Products and was being billed the Rs 25,000 every month. A module can
 * be in every plan on offer and still be past ONE shop's plan: its trade does
 * not usually take it, or its plan has since been switched off. Nobody is
 * charged only when no plan leaves it out AND no shop has it as an add-on.
 */
export function reachSays(reach: AddOnReach | undefined): ReachSaid | null {
  if (!reach) return null;

  if (reach.plans.length === 0) {
    if (reach.shops === 0) {
      return { kind: "never", says: "In every plan on offer, and no shop has it as an add-on — a price here is charged to nobody." };
    }

    const { names, one } = who(reach);

    return {
      kind: "anyway",
      says:
        `In every plan on offer, yet ${names} ${one ? "has" : "have"} it as an add-on — ` +
        `${one ? "its" : "their"} trade does not usually take it, or ${one ? "its" : "their"} plan is no longer offered. ` +
        `A price here goes on ${one ? "its bill" : "their bills"} unless ${one ? "it has" : "they have"} one of ${one ? "its" : "their"} own.`,
    };
  }

  const on = reach.plans.length <= 3 ? reach.plans.join(", ") : `${reach.plans.slice(0, 3).join(", ")} and ${reach.plans.length - 3} more`;
  // "Has it as an add-on", not "pays for it": an add-on left unpriced is
  // free, and a shop may have been given its own price of nought.
  const taken =
    reach.shops === 0
      ? "no shop has taken it yet"
      : `${reach.shops.toLocaleString()} ${reach.shops === 1 ? "shop has" : "shops have"} it as an add-on now`;

  return { kind: "somewhere", says: `An add-on on ${on} · ${taken}.` };
}

/**
 * A PRICE DOING SOMETHING ITS BOX DOES NOT SUGGEST — the line is drawn loud.
 *
 * Two of the three answers are a surprise once there is a price beside them:
 * `never`, where the figure typed is charged to nobody (what was first asked
 * about), and `anyway`, where it is charged to a shop nobody would think to
 * look at (what was actually happening). Left free, neither is anything to
 * act on, and on a database of test shops given every module a third of the
 * list was shouting about boxes that were empty.
 */
export function pricedOddly(said: ReachSaid | null, price: number): boolean {
  return said !== null && said.kind !== "somewhere" && price > 0;
}
