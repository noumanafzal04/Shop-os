import { expect, type Page } from "@playwright/test";

/**
 * What a browser can tell you that a source file cannot.
 *
 * Every rule here exists because a shop found the defect on a real device while
 * a thousand green tests said nothing. They are deliberately GENERIC — a rule
 * that only knows about the Appearance panel's close button would have caught
 * that one bug and no other.
 */

/** Anything a person is meant to press. */
const PRESSABLE =
  'button, a[href], [role="button"], [role="tab"], input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

export type Finding = { what: string; detail: string };
type Suspect = Finding & { mark: string };

async function visiblePressables(page: Page) {
  return page.evaluate((selector) => {
    const seen: Array<{
      key: string; x: number; y: number; w: number; h: number; label: string;
    }> = [];

    for (const el of Array.from(document.querySelectorAll(selector))) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);

      // Off-screen, collapsed, or deliberately invisible is not a tap target.
      if (r.width === 0 || r.height === 0) continue;
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (Number(style.opacity) === 0) continue;
      if (r.bottom <= 0 || r.right <= 0) continue;
      if (r.top >= innerHeight || r.left >= innerWidth) continue;
      if ((el as HTMLElement).getAttribute("aria-hidden") === "true") continue;
      // A disabled control is not something the shop is being asked to press.
      if ((el as HTMLInputElement).disabled) continue;

      const label =
        (el as HTMLElement).getAttribute("aria-label") ||
        (el as HTMLElement).getAttribute("title") ||
        (el.textContent ?? "").trim().slice(0, 40) ||
        `<${el.tagName.toLowerCase()}>`;

      // A stable-ish handle for the report. Not a selector — a description.
      const key = `${el.tagName.toLowerCase()}${(el as HTMLElement).className
        ? "." + String((el as HTMLElement).className).split(/\s+/).slice(0, 2).join(".")
        : ""}`;

      seen.push({ key, x: r.x, y: r.y, w: r.width, h: r.height, label });
    }
    return seen;
  }, PRESSABLE);
}

/**
 * NOTHING A FINGER MUST PRESS IS COVERED BY SOMETHING ELSE.
 *
 * This is the rule the Appearance panel broke. Its close button was drawn at
 * `z-99999`; the app header was drawn at `z-99999` too and came later, so the
 * header sat on top of it. The button was there, it was the right size, it had
 * the right handler, and the source looked correct — the click simply never
 * reached it, because at that pixel the header was in front.
 *
 * No amount of reading the JSX finds that. `elementFromPoint` finds it every
 * time, at every viewport, for every control on the screen.
 *
 * TWO PASSES, and the second one is the honest half. A control under a bar
 * pinned to the bottom of the screen is not necessarily unreachable — a person
 * scrolls, the control comes out from under it, and they press it. What makes
 * it unreachable is having nowhere to scroll TO. So anything the first pass
 * flags is scrolled to the middle of the screen and asked again; only what is
 * still covered there is a finding. That is the question a shop actually has:
 * not "is it covered right now" but "can I press it at all".
 */
export async function nothingIsCovered(page: Page): Promise<Finding[]> {
  const suspects = await page.evaluate((selector) => {
    const out: Suspect[] = [];

    for (const el of Array.from(document.querySelectorAll(selector))) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0) continue;
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (Number(style.opacity) === 0) continue;
      if (style.pointerEvents === "none") continue;
      if ((el as HTMLInputElement).disabled) continue;
      if ((el as HTMLElement).getAttribute("aria-hidden") === "true") continue;

      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;

      const hit = document.elementFromPoint(x, y);
      if (hit === null) continue;

      // Its own child is fine — a <span> inside a <button> still presses the
      // button. Its own ancestor is fine too: the click bubbles nowhere else.
      if (hit === el || el.contains(hit) || hit.contains(el)) continue;

      // A CONTROL COVERED BY ITS OWN LABEL IS NOT COVERED.
      //
      // Every switch and checkbox in this codebase is a visually-hidden input
      // inside a <label> with a drawn span on top of it, which is the correct
      // way to build one: the span is what a finger lands on, and the label
      // forwards the press to the input. The first run of this rule reported
      // that same input on eleven screens — it is in the layout, so it is on
      // every page — and every one of those was the pattern working.
      let wrapper: HTMLElement | null = hit as HTMLElement;
      let forwarded = false;
      while (wrapper) {
        if (wrapper.tagName === "LABEL") {
          const target = (wrapper as HTMLLabelElement).control
            ?? ((wrapper as HTMLLabelElement).htmlFor
                ? document.getElementById((wrapper as HTMLLabelElement).htmlFor)
                : null);
          if (target === el || wrapper.contains(el)) { forwarded = true; break; }
        }
        wrapper = wrapper.parentElement;
      }
      if (forwarded) continue;

      const label =
        (el as HTMLElement).getAttribute("aria-label") ||
        (el as HTMLElement).getAttribute("title") ||
        (el.textContent ?? "").trim().slice(0, 40) ||
        `<${el.tagName.toLowerCase()}>`;

      const over = `${hit.tagName.toLowerCase()}${
        (hit as HTMLElement).className
          ? "." + String((hit as HTMLElement).className).split(/\s+/).slice(0, 3).join(".")
          : ""
      }`;

      // Mark it so the second pass can find this exact element again.
      const mark = `e2e-${out.length}`;
      (el as HTMLElement).setAttribute("data-e2e-suspect", mark);

      out.push({
        what: `"${label}" cannot be pressed`,
        detail: `at (${Math.round(x)}, ${Math.round(y)}) the front-most element is ${over}`,
        mark,
      });
    }
    return out;
  }, PRESSABLE);

  if (suspects.length === 0) return [];

  // ── second pass: scroll each one into the middle and ask again ──────
  return page.evaluate(async (marked) => {
    const still: Finding[] = [];

    for (const suspect of marked) {
      const el = document.querySelector(`[data-e2e-suspect="${suspect.mark}"]`);
      if (el === null) continue;

      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
        still.push({
          what: suspect.what,
          detail: "it cannot even be scrolled onto the screen",
        });
        continue;
      }

      const hit = document.elementFromPoint(x, y);
      if (hit === null || hit === el || el.contains(hit) || hit.contains(el)) continue;

      const over = `${hit.tagName.toLowerCase()}${
        (hit as HTMLElement).className
          ? "." + String((hit as HTMLElement).className).split(/\s+/).slice(0, 3).join(".")
          : ""
      }`;
      still.push({
        what: suspect.what,
        detail: `${suspect.detail}; still covered by ${over} after scrolling it into the middle`,
      });
    }

    for (const el of Array.from(document.querySelectorAll("[data-e2e-suspect]"))) {
      el.removeAttribute("data-e2e-suspect");
    }
    return still;
  }, suspects);
}

/**
 * THE PAGE DOES NOT SCROLL SIDEWAYS.
 *
 * A shop scrolls a table sideways on purpose. A shop never scrolls the PAGE
 * sideways — when that happens something is wider than the screen and the
 * controls at its right edge are simply gone, with no scrollbar to say so. The
 * till's own header did this: `flex-nowrap overflow-x-auto no-scrollbar` meant
 * Drawer and Close were off the screen and nothing indicated it.
 */
export async function noSidewaysScroll(page: Page): Promise<Finding[]> {
  // MEASURED TWICE, AND IT HAS TO STILL BE TRUE.
  //
  // The rail animates for 300ms (`transition-all duration-300`), and mid-flight
  // the page really is wider than the window. Caught at that instant this rule
  // reported the reports screen — which then passed three runs out of three on
  // its own. A rule that fires once and never again teaches the reader to
  // ignore rules, so a transient overflow during an animation is not a finding.
  const first = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth > d.clientWidth + 2;
  });
  if (!first) return [];

  await page.waitForTimeout(400);

  return page.evaluate(() => {
    const doc = document.documentElement;
    const slack = 2; // sub-pixel rounding, not a defect
    if (doc.scrollWidth <= doc.clientWidth + slack) return [];

    // Name the widest offender, or the finding is a number nobody can act on.
    let worst: Element | null = null;
    let worstRight = doc.clientWidth;
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(el).position === "fixed") continue;
      if (r.right > worstRight) {
        worstRight = r.right;
        worst = el;
      }
    }

    const name = worst
      ? `${worst.tagName.toLowerCase()}.${String((worst as HTMLElement).className)
          .split(/\s+/).slice(0, 3).join(".")}`
      : "unknown";

    return [{
      what: "the page scrolls sideways",
      detail: `${doc.scrollWidth}px of content in a ${doc.clientWidth}px window; widest is ${name} reaching ${Math.round(worstRight)}px`,
    }];
  });
}

/**
 * WHAT IS OPEN FITS ON THE SCREEN.
 *
 * A dialog taller than the window makes the cashier scroll the PAGE to reach
 * the button that takes the money — with a customer waiting and a queue behind
 * them. The payment modal did this on a tablet: its own body scrolled, but only
 * after the panel had already grown past the bottom of the screen.
 */
export async function openThingsFit(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const out: Finding[] = [];
    const panels = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');

    for (const el of Array.from(panels)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      if (r.height > innerHeight + 2) {
        out.push({
          what: "an open panel is taller than the screen",
          detail: `${Math.round(r.height)}px in a ${innerHeight}px window`,
        });
      }
      if (r.bottom > innerHeight + 2 || r.top < -2) {
        out.push({
          what: "an open panel runs off the screen",
          detail: `top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)}, window ${innerHeight}`,
        });
      }
    }
    return out;
  });
}

/**
 * EVERY TAP TARGET IS BIG ENOUGH FOR A FINGER.
 *
 * The Appearance close button was 28×28. It was also covered, and fixing only
 * the covering left it still unpressable — two causes, one symptom, and the
 * second was invisible until the first was gone.
 *
 * The floor is deliberately below the 44px both Apple and WCAG ask for: this
 * codebase has icon buttons at 36 and 40 that a shop presses all day without
 * complaint, and a rule that flags two hundred of those is a rule nobody reads.
 * 32 is the line where "small" becomes "cannot".
 */
export const FINGER = 32;

export async function tapTargetsAreFingerSized(
  page: Page,
): Promise<{ findings: Finding[]; examined: number }> {
  const found = await visiblePressables(page);
  return {
    examined: found.length,
    findings: found
      .filter((t) => t.w < FINGER || t.h < FINGER)
      .map((t) => ({
        what: `"${t.label}" is too small to press`,
        detail: `${Math.round(t.w)}×${Math.round(t.h)}, floor is ${FINGER}`,
      })),
  };
}

/**
 * THE PAGE ENDS ABOVE WHAT IS PINNED TO IT, NOT BEHIND IT.
 *
 * `nothingIsCovered` asks whether a control can be pressed AT ALL, and answers
 * "yes, scroll first" — which is true and is not the whole story. A card pinned
 * to the bottom of the screen still lands on top of the page's own content, and
 * the shop discovers that by tapping a field and hitting a banner.
 *
 * This rule asks the sharper question: scroll to the very bottom, and see
 * whether the page's last content still sits underneath the pinned card. If the
 * layout has reserved room for it, nothing does. If it has not, the overlap is
 * permanent — there is nowhere further to scroll.
 *
 * Written after the first version of the covering rule went GREEN against the
 * defect it was written for, because scrolling to the middle moved the control
 * out from under the card. A rule that cannot fail is not a rule.
 */
export async function pinnedThingsDoNotSitOnThePage(page: Page): Promise<Finding[]> {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(150);

  return page.evaluate(() => {
    const out: Finding[] = [];

    /**
     * What of this element is actually ON the screen.
     *
     * `getBoundingClientRect()` reports the element's full box even when most
     * of it is scrolled out of an ancestor with `overflow: auto`. The Help
     * Centre's last paragraph sits in exactly that: its box ran to y=729 while
     * the scroller clipped it at y=700, so this rule reported it overlapping a
     * card at y=712 that no reader could ever see it behind.
     *
     * A rule about what a person sees has to measure what a person sees, so the
     * box is intersected with every ancestor that clips it.
     */
    const visibleRect = (el: Element): DOMRect | null => {
      const box = el.getBoundingClientRect();
      let top = box.top, left = box.left, right = box.right, bottom = box.bottom;

      let p = el.parentElement;
      while (p) {
        const cs = getComputedStyle(p);
        if (cs.overflowY !== "visible" || cs.overflowX !== "visible") {
          const c = p.getBoundingClientRect();
          top = Math.max(top, c.top);
          left = Math.max(left, c.left);
          right = Math.min(right, c.right);
          bottom = Math.min(bottom, c.bottom);
        }
        p = p.parentElement;
      }

      if (right <= left || bottom <= top) return null;   // clipped away entirely
      return new DOMRect(left, top, right - left, bottom - top);
    };

    // Cards the app pins to the bottom of the viewport.
    const pinned = Array.from(document.body.querySelectorAll<HTMLElement>("*")).filter((el) => {
      if (getComputedStyle(el).position !== "fixed") return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      // Sitting on the bottom edge, and not full-height chrome like a sidebar.
      return r.bottom > innerHeight - 40 && r.height < innerHeight / 2;
    });

    for (const card of pinned) {
      const box = card.getBoundingClientRect();

      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        if (card.contains(el) || el.contains(card)) continue;
        if (getComputedStyle(el).position === "fixed") continue;
        if (el.children.length > 0) continue;          // leaves only: the actual content
        if ((el.textContent ?? "").trim() === "" && el.tagName !== "INPUT") continue;

        const r = visibleRect(el);
        if (r === null || r.width === 0 || r.height === 0) continue;

        const overlaps =
          r.left < box.right && r.right > box.left &&
          r.top < box.bottom && r.bottom > box.top;

        if (!overlaps) continue;

        const label = (el.textContent ?? "").trim().slice(0, 40) || `<${el.tagName.toLowerCase()}>`;
        out.push({
          what: `the page still runs under a pinned card at the very bottom`,
          detail: `"${label}" overlaps it with nowhere left to scroll — the layout reserves no room for it`,
        });
        break; // one report per card is enough to act on
      }
    }
    return out;
  });
}

/**
 * DID THIS PAGE ACTUALLY RENDER?
 *
 * Every rule in this file is of the form "nothing here is wrong", and a page
 * that rendered nothing satisfies all of them — it looks exactly like a page
 * that is perfect. That is not hypothetical: this suite spent an afternoon
 * testing the shop setup form fourteen times over while reporting it as the
 * dashboard, the catalog, the reports and the till, and everything passed.
 *
 * The first version counted TAP TARGETS, which is the wrong question on a page
 * people read rather than press: the Help Centre in portrait folds its topic
 * list behind a toggle and shows two buttons and four thousand words. Counting
 * buttons called that empty.
 *
 * So it counts what is on the screen — elements and visible text — because
 * "did this render" is a question about content, not about controls.
 */
export async function renderedSize(page: Page): Promise<{ elements: number; text: number }> {
  return page.evaluate(() => ({
    elements: document.body.querySelectorAll("*").length,
    text: (document.body.innerText ?? "").trim().length,
  }));
}

/**
 * Every rule, in an order that does not let one disturb the next.
 *
 * The order is load-bearing, which is not obvious and cost a flake to learn.
 * `nothingIsCovered` SCROLLS — it has to, since its whole question is whether a
 * control can be brought into reach — and `scrollIntoView({ inline: "center" })`
 * moves things sideways as well as up. Run after it, the sideways-scroll rule
 * fired once and then never again, which is the worst way for a rule to behave:
 * a finding nobody can reproduce teaches the reader to ignore findings.
 *
 * So the two rules that measure the page AT REST go first, and everything is
 * scrolled back to the corner before the rule that needs the bottom.
 */
export async function everyRule(page: Page): Promise<Finding[]> {
  const atRest = [
    ...(await noSidewaysScroll(page)),
    ...(await openThingsFit(page)),
  ];

  const reachable = await nothingIsCovered(page);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);

  return [...atRest, ...reachable, ...(await pinnedThingsDoNotSitOnThePage(page))];
}

export function report(findings: Finding[], where: string): void {
  expect(
    findings,
    findings.length
      ? `\n${where}\n` + findings.map((f) => `  · ${f.what}\n      ${f.detail}`).join("\n") + "\n"
      : where,
  ).toEqual([]);
}
