import { describe, expect, it } from "vitest";

/**
 * #SV1 — A SHOP THAT BILLS FROM THE JOB BOARD HAS CASH CONTROL TOO.
 *
 * A tailor took a Rs 2,000 advance and a Rs 3,630 balance in cash and never
 * opened a drawer. Day & banking said "No day open yet", and CASH TAKINGS
 * Rs 0 once a drawer was opened later. Two halves answer it: the job card
 * says, before the cash is taken, that it will reach no drawer; and the day
 * screen says what was taken when nobody opened a day. Read as text — both
 * screens sit behind a shop session and four queries.
 */
const read = (glob: Record<string, unknown>): string => Object.values(glob).join("\n");
const dayPage = read(import.meta.glob("./pages/DayPage.tsx", { query: "?raw", import: "default", eager: true }));
const useDay = read(import.meta.glob("./hooks/useDay.ts", { query: "?raw", import: "default", eager: true }));
const jobCard = read(import.meta.glob("../documents/pages/DocumentDetailPage.tsx", { query: "?raw", import: "default", eager: true }));
const collect = read(import.meta.glob("../documents/components/CollectModal.tsx", { query: "?raw", import: "default", eager: true }));

describe("cash taken with no drawer", () => {
  it("is said on the day screen when no day was opened, in place of 'No day open yet'", () => {
    expect(useDay).toMatch(/taken_with_no_drawer\?: TakenWithNoDrawer/);
    expect(dayPage).toMatch(/\{takenWithNoDrawer\.data \? \(/);
    expect(dayPage).toMatch(/No drawer has been opened today — but \{money\(takenWithNoDrawer\.data\.sales_total\)\} was taken in/);
  });

  it("is said on the job card before an advance or a balance is taken in cash", () => {
    expect(jobCard).toMatch(/const noDrawer = useCashReachesNoDrawer\(method, Number\(amount\) \|\| 0\);/);
    expect(jobCard).toMatch(/<NoDrawerNote note=\{noDrawer\} \/>/);
    expect(collect).toMatch(/const noDrawer = useCashReachesNoDrawer\(onKhata \? "khata" : method, due > 0 \? paid : 0\);/);
    expect(collect).toMatch(/<NoDrawerNote note=\{noDrawer\} \/>/);
  });
});
