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
  /** What the book-in sheet asks about the work itself. */
  asks: string;
  /** The same thing, as a label on the job afterwards. */
  said: string;
  /** What goes on a job as it is done, as the start of a sentence. */
  goesOn: string;
  /** The box that finds the first thing to open a job with. */
  findItem: string;
  /** The box that puts one more thing on an open job. */
  addLine: string;
  /** What the first item on the take-in sheet usually is. */
  opensWith: string;
  /** The take-in sheet's own button. */
  confirm: string;
  /** The board's find box. */
  find: string;
}

const WORKSHOP: BoardWords = {
  board: "Workshop",
  unit: "car",
  units: "cars",
  takeIn: "Book a car in",
  stages: ["In the bay", "Being worked on", "Ready"],
  hints: ["Booked in, not started", "On the ramp", "Waiting to be collected"],
  tracksVehicle: true,
  asks: "What is wrong, in the customer\u2019s words",
  said: "What the customer said",
  goesOn: "Parts and labour",
  findItem: "Search a part or a labour item",
  addLine: "Add a part or labour",
  opensWith: "the diagnostic hour, or the part you already know it needs",
  confirm: "Book in",
  find: "Find a car — plate, name, phone or job number",
};

const JOBS: BoardWords = {
  board: "Jobs",
  unit: "job",
  units: "jobs",
  takeIn: "Take work in",
  stages: ["Taken in", "Being worked on", "Ready"],
  hints: ["Received, not started", "In progress", "Waiting to be collected"],
  tracksVehicle: false,
  // Nothing is "wrong" with eight shirts or two metres of cloth.
  asks: "What they want done",
  said: "Instructions",
  // A laundry has no "parts", and nobody calls pressing a shirt "labour".
  goesOn: "The work and anything used",
  findItem: "Search the work or an item",
  addLine: "Add work or an item",
  opensWith: "usually the work they asked for, and how many pieces",
  confirm: "Take it in",
  find: "Find a job — slip number, name or phone",
};

/** Which trades run a board of work taken in. */
export function hasJobBoard(businessType: string | null | undefined): boolean {
  return businessType === "automotive" || businessType === "services";
}

export function boardWords(businessType: string | null | undefined): BoardWords {
  return businessType === "automotive" ? WORKSHOP : JOBS;
}
