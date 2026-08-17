/**
 * What this trade calls the work sitting in its shop.
 *
 * ── One board, two trades ───────────────────────────────────────────────
 *
 * A job card is work TAKEN IN: it accumulates lines over hours or days, nobody
 * knows the price when it arrives, and it becomes an invoice when the customer
 * collects. That is a workshop — and it is also, exactly, a laundry, a tailor,
 * a cobbler and a phone-repair counter.
 *
 * The document was never fenced to automotive: `StoreSaleDocumentRequest`
 * accepts `job_card` from any tenant. Only the SCREEN was, so a dry cleaner
 * could create the very record it needs through the API and had nowhere to see
 * it. The same "built, one link missing" shape this codebase keeps producing.
 *
 * ── This is not booking, and must never become it ───────────────────────
 *
 * Appointment booking is permanently out of scope, and the two are close enough
 * to confuse: booking is a promise about a FUTURE slot, with a diary and a
 * no-show problem. This board only ever holds work that is already in the shop,
 * with the goods in the back. Nothing here schedules anything.
 *
 * ── Vocabulary, not behaviour ───────────────────────────────────────────
 *
 * The shape is identical; only the nouns move. A dry cleaner has no
 * registration plate and does not put shirts "in the bay", and a board that
 * asks a tailor for a car's odometer is a board a tailor closes. Nothing below
 * changes what the screen DOES — inventing separate flows for two trades that
 * do the same thing is how one feature becomes two half-maintained ones.
 */

export interface BoardWords {
  /** The screen's own name, in the menu and on the page. */
  board: string;
  /** One piece of work. */
  unit: string;
  /** Plural, for counts. */
  units: string;
  /** The verb on the button that starts one. */
  takeIn: string;
  /** The three stages, in order. */
  stages: [string, string, string];
  /** Sub-labels under each stage. */
  hints: [string, string, string];
  /**
   * Does this trade identify the work by a vehicle? Automotive does — the plate
   * IS the job, and it carries the car's whole history. Nobody else has one,
   * and asking a tailor for a registration is how a screen loses a trade.
   */
  tracksVehicle: boolean;
}

const WORKSHOP: BoardWords = {
  board: "Workshop",
  unit: "car",
  units: "cars",
  takeIn: "Book a car in",
  stages: ["In the bay", "Being worked on", "Ready"],
  hints: ["Booked in, not started", "On the ramp", "Waiting to be collected"],
  tracksVehicle: true,
};

const JOBS: BoardWords = {
  board: "Jobs",
  unit: "job",
  units: "jobs",
  takeIn: "Take work in",
  stages: ["Taken in", "Being worked on", "Ready"],
  hints: ["Received, not started", "In progress", "Waiting to be collected"],
  tracksVehicle: false,
};

/** Which trades run a board of work taken in. */
export function hasJobBoard(businessType: string | null | undefined): boolean {
  return businessType === "automotive" || businessType === "services";
}

export function boardWords(businessType: string | null | undefined): BoardWords {
  return businessType === "automotive" ? WORKSHOP : JOBS;
}
