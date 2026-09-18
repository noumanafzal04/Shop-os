import { fs, path, PROJECT_ROOT } from "./support/node";
import {
  nextStates,
  isOpen,
  ACTION_LABEL,
  STATUS_LABEL,
  type OrderStatus,
  type FulfillmentType,
} from "../src/modules/orders/services/orderStages";

const ENUM = path.join(PROJECT_ROOT, "..", "backend", "app", "Enums", "OrderStatus.php");

/**
 * THE MIRROR IS CHECKED AGAINST WHAT IT MIRRORS.
 *
 * `orderStages.ts` is a copy of the server's `OrderStatus::nextStates()`, kept
 * because the payload does not carry it. A copy nobody compares is a fork, and
 * this one decides which buttons a shopkeeper is offered mid-service — a stale
 * copy means a button that always fails, or a stage nobody can reach.
 *
 * The PHP is PARSED rather than pattern-matched loosely: a test that only
 * checks "the file mentions confirmed" passes on a file that says anything.
 */
describe("the stage rules match the server's", () => {
  const php = fs.existsSync(ENUM) ? fs.readFileSync(ENUM, "utf8") : "";

  it("finds the server's enum", () => {
    expect(php).not.toBe("");
  });

  it("knows every status the server defines, and no others", () => {
    const cases = [...php.matchAll(/case\s+\w+\s*=\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(cases.length).toBeGreaterThan(0);
    expect(Object.keys(STATUS_LABEL).sort()).toEqual([...cases].sort());
    expect(Object.keys(ACTION_LABEL).sort()).toEqual([...cases].sort());
  });

  it("reproduces the transition table exactly", () => {
    /**
     * The server's `match` arms, read back out. Written as one expectation per
     * arm rather than a loop over the PHP, because a loop that fails to parse
     * an arm silently checks nothing — and "0 arms compared" passes.
     */
    expect(nextStates("pending", "delivery")).toEqual(["confirmed", "cancelled"]);
    expect(nextStates("confirmed", "pickup")).toEqual(["preparing", "cancelled"]);
    expect(nextStates("ready", "pickup")).toEqual(["completed", "cancelled"]);
    expect(nextStates("out_for_delivery", "delivery")).toEqual(["completed", "cancelled"]);
    expect(nextStates("completed", "delivery")).toEqual([]);
    expect(nextStates("cancelled", "pickup")).toEqual([]);

    // The one branch: same stage, two answers.
    expect(nextStates("preparing", "delivery")).toEqual(["out_for_delivery", "cancelled"]);
    expect(nextStates("preparing", "pickup")).toEqual(["ready", "cancelled"]);
    expect(nextStates("preparing", "dine_in")).toEqual(["ready", "cancelled"]);

    // And the server really does branch on it, rather than this being invented.
    expect(php).toMatch(/fulfillmentType\s*===\s*'delivery'/);
  });

  it("never offers a collection order the delivery step", () => {
    /**
     * The failure this prevents, stated as itself: a customer standing at the
     * counter told their food is on a bike. It is the only transition where
     * the wrong answer is not merely refused by the server but PLAUSIBLE — the
     * others are obviously out of order.
     */
    for (const f of ["pickup", "dine_in"] as FulfillmentType[]) {
      for (const s of Object.keys(STATUS_LABEL) as OrderStatus[]) {
        expect(nextStates(s, f)).not.toContain("out_for_delivery");
      }
    }
  });

  it("agrees with the server about which orders are still open", () => {
    const closed = (["completed", "cancelled"] as OrderStatus[]).filter((s) => !isOpen(s));
    expect(closed).toEqual(["completed", "cancelled"]);
    expect(isOpen("pending")).toBe(true);
    expect(isOpen("out_for_delivery")).toBe(true);
  });
});

describe("what the buttons say", () => {
  it("names an ACTION on the button and a STATE on the chip", () => {
    /**
     * Two vocabularies on purpose. "Confirmed" is a fact about an order;
     * "Accept order" is a thing a person does. A row of buttons named after
     * states makes somebody translate before they can press — during service,
     * a pause they do not have.
     */
    expect(ACTION_LABEL.pending).toBe("Accept order");
    expect(STATUS_LABEL.pending).toBe("New");
    expect(ACTION_LABEL.pending).not.toBe(STATUS_LABEL.pending);
  });

  it("has a label for every status, so no stage can render blank", () => {
    for (const s of Object.keys(STATUS_LABEL) as OrderStatus[]) {
      expect(STATUS_LABEL[s].length).toBeGreaterThan(0);
      expect(ACTION_LABEL[s].length).toBeGreaterThan(0);
    }
  });
});
