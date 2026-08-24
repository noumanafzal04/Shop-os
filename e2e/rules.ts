import { expect, type Page } from "@playwright/test";

import { BY_PROJECT } from "./skipReporter";

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

      // A MODAL IS SUPPOSED TO COVER THE PAGE.
      //
      // `/tenant/products/new` IS a dialog — the product form is a drawer over
      // the catalogue, `aria-modal="true"` and all — so the first time this
      // rule met one it reported the whole sidebar, the wordmark and every menu
      // item as unpressable. All correct, all behind a backdrop doing its job.
      //
      // While a modal is open, the only controls anybody is meant to reach are
      // the ones inside it, so those are the only ones judged. Controls INSIDE
      // the modal are still judged normally, which is the half that matters:
      // a close button under a header is one of the defects this suite was
      // written for, and it lives in exactly this kind of panel.
      const modal = document.querySelector('[aria-modal="true"]');
      if (modal !== null && !modal.contains(el)) continue;

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
    //
    // CLIPPED, or it names the wrong thing — which it did, twice. A decorative
    // blur inside an `overflow-hidden` header measured 453px wide and was
    // reported as the cause of a 425px page; so did a table already sitting in
    // its own `overflow-x-auto` box. Neither pushes anything: their parents cut
    // them off. The real culprits were a header group that could not shrink and
    // a row of filter chips that would not wrap, and both were invisible behind
    // the wrong name.
    const clippedRight = (el: Element): number => {
      let right = el.getBoundingClientRect().right;
      let p = el.parentElement;
      while (p) {
        if (getComputedStyle(p).overflowX !== "visible") {
          right = Math.min(right, p.getBoundingClientRect().right);
        }
        p = p.parentElement;
      }
      return right;
    };

    const insideFixed = (el: Element): boolean => {
      let n: Element | null = el;
      while (n) {
        if (getComputedStyle(n).position === "fixed") return true;
        n = n.parentElement;
      }

      return false;
    };

    let worst: Element | null = null;
    let worstRight = doc.clientWidth;
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // FIXED, or INSIDE something fixed. Skipping only the fixed element
      // itself left its children fair game, and the appearance drawer parks
      // off-screen right with a static header inside it — so every screen in
      // the shop was told its sideways scroll was caused by a panel nobody had
      // opened, reaching 1616px in a 1280px window while the real overflow was
      // eighteen pixels of something else.
      //
      // Third time this rule has named the wrong thing; the two before are in
      // the note above. A culprit that cannot push anything is not a culprit.
      if (insideFixed(el)) continue;
      const right = clippedRight(el);

      // `>=`, and the deepest wins a tie.
      //
      // A parent stretched by a child reaches exactly as far as the child does,
      // and document order put the PARENT first — so the finding named the page
      // container on every screen, which is the symptom and never something
      // anybody can go and fix. The innermost element at the far edge is the
      // one that refused to shrink.
      if (right >= worstRight) {
        worstRight = right;
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

      // A CLOSED SHEET IS NOT AN OVERFLOWING ONE.
      //
      // A bottom sheet waits parked just below the fold and slides up when
      // opened, so at rest its top sits exactly on the bottom edge of the
      // window. Measured naively that reads as a panel running 564px off the
      // screen — which is what this rule reported on the expenses page, about
      // a drawer nobody had opened.
      if (r.top >= innerHeight - 1) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      if (el.getAttribute("aria-hidden") === "true") continue;

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

      // OVERLAP IS NOT THE SAME AS HIDDEN — asked ONCE, about the card.
      //
      // This rule tested only whether two boxes share space, so it went on
      // reporting a dialog's footer after the fix that mattered: the install
      // card had been dropped BELOW the modal layer, where it sits behind the
      // footer and hides nothing.
      //
      // The first version of this check asked per ELEMENT, inside the loop
      // below, and `elementFromPoint` forces a synchronous layout. With the
      // card behind — now the ordinary case — nothing ever matched, the loop
      // never broke, and a screen check that takes four seconds took
      // FIFTY-FOUR MINUTES on a phone. The question belongs to the card, not
      // to each of the thousand text nodes it happens to overlap.
      //
      // Three samples rather than one: a card can lose its centre to a tooltip
      // and still cover everything either side of it.
      const y = box.top + box.height / 2;
      const inFront = [box.left + box.width * 0.2, box.left + box.width * 0.5, box.left + box.width * 0.8]
        .some((x) => {
          const front = document.elementFromPoint(x, y);
          return front === null || card.contains(front);
        });
      if (!inFront) continue;

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
 * A CARD IS A SURFACE, NOT A TINT.
 *
 * The till's product tiles were a translucent white on a dark ground. They were
 * raised once — 10% to 16% — and the shop still reported the list as "simple
 * text, you cannot tell these are cards". Raising it again would not have
 * helped, and that is the point: **a translucent panel on a dark ground has no
 * edge at any opacity.** What makes a card a card is that it is opaque and has
 * a border, so the eye finds where one product stops and the next begins.
 *
 * Measured, not asserted about the source: `getComputedStyle` resolves whatever
 * the class list actually produced, including the alpha nobody meant to keep.
 */
export async function cardsAreSurfaces(
  page: Page,
): Promise<{ findings: Finding[]; examined: number }> {
  return page.evaluate(() => {
    const out: Finding[] = [];
    /**
     * How opaque a computed colour is, in whatever notation the browser used.
     *
     * Tailwind v4 emits modern colour syntax, so a 10% white surface computes
     * to `oklab(1 0 0 / 0.1)` — not `rgba(255, 255, 255, 0.1)`. The first
     * version of this only understood `rgba()` and returned 1 for everything
     * else, so it read that translucent list as fully opaque and passed against
     * the exact design the shop had complained about. Twice.
     *
     * Two notations, and both have to be read: the legacy comma form puts alpha
     * fourth, the modern form puts it after a slash. `transparent` is neither.
     */
    const alphaOf = (colour: string): number => {
      const c = colour.trim().toLowerCase();
      if (c === "transparent" || c === "") return 0;

      // Modern: oklab(… / .1), oklch(… / 10%), rgb(… / .1), color(srgb … / .1)
      const slash = c.match(/\/\s*([0-9.]+)(%?)\s*\)/);
      if (slash) {
        const n = parseFloat(slash[1]);
        return slash[2] === "%" ? n / 100 : n;
      }

      // Legacy: rgba(r, g, b, a) / hsla(h, s, l, a)
      const legacy = c.match(/^(?:rgba|hsla)\(([^)]+)\)/);
      if (legacy) {
        const parts = legacy[1].split(",").map((n) => parseFloat(n));
        return parts.length > 3 ? parts[3] : 1;
      }

      return 1;
    };

    // The product list, whichever view it is drawn in. `data-pos-item` rather
    // than a guess at class names: the guess ("wider than 80px with `rounded`
    // in its classes") matched tiles and no rows, so on a shop whose till
    // defaults to rows this rule examined one element and passed.
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>("[data-pos-item]"),
    ).slice(0, 40);

    /**
     * What this item is actually drawn ON.
     *
     * In tile view each product paints its own background. In ROW view it does
     * not — the list container is the surface and the rows only tint on hover —
     * so asking the row about its own background gives `rgba(…, 0)` and tells
     * you nothing. The first version skipped exactly those, and passed against a
     * 10%-white list on a dark ground, which is the design the shop complained
     * about.
     *
     * So: walk up until something paints, and judge that.
     */
    const surfaceOf = (el: HTMLElement): { el: HTMLElement; colour: string } | null => {
      let node: HTMLElement | null = el;
      while (node && node !== document.body) {
        const colour = getComputedStyle(node).backgroundColor;
        if (alphaOf(colour) > 0) return { el: node, colour };
        node = node.parentElement;
      }
      return null;
    };

    for (const card of cards) {
      const surface = surfaceOf(card);
      if (surface === null) {
        out.push({
          what: "a product sits on nothing",
          detail: `${(card.textContent ?? "").trim().slice(0, 30)} has no painted surface anywhere above it`,
        });
        break;
      }

      if (alphaOf(surface.colour) >= 0.95) continue;   // opaque: a real surface

      out.push({
        what: "a card is a tint, not a surface",
        detail: `${(card.textContent ?? "").trim().slice(0, 30)} is drawn on ${surface.colour} — ` +
          "translucent over the ground behind it, so it has no findable edge",
      });
      break; // one is enough to act on
    }
    // THE DENOMINATOR. A till with no shift open draws no product tiles at all,
    // and this rule then passed against the very design it was written to
    // reject — it had examined nothing. Again.
    return { findings: out, examined: cards.length };
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
/**
 * PUT THE PAGE BACK TO WHAT A FINGER CAN REACH.
 *
 * `scrollIntoViewIfNeeded` — and `scrollTop = n` generally — will scroll a box
 * whose `overflow` is `hidden`. A finger will not: `overflow: hidden` means no
 * touch scrolling, no wheel, no scrollbar. So a check that scrolls an element
 * into view and then asks "is it visible" can answer YES about content the shop
 * can never see, which is exactly how the cart test went green while the phone
 * showed three lines of nine.
 *
 * Called before measuring, this undoes any scroll on a box that cannot be
 * scrolled by hand, and leaves real scrollers exactly where they were.
 */
export async function onlyWhatAFingerCanReach(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      if (el.scrollTop === 0 && el.scrollLeft === 0) continue;
      const cs = getComputedStyle(el);
      const scrollable = (v: string) => v === "auto" || v === "scroll";
      if (!scrollable(cs.overflowY)) el.scrollTop = 0;
      if (!scrollable(cs.overflowX)) el.scrollLeft = 0;
    }
  });
}

/**
 * A SCROLLER MUST BE ABLE TO SHOW ITS OWN LAST LINE.
 *
 * The shop put nine lines in the cart and saw six. Not because the list would
 * not scroll — it scrolled fine — but because the scroller's own box was TALLER
 * THAN THE CARD THAT CLIPS IT. Its bottom 120px lay outside the frame, so the
 * rows you scrolled down to arrived in a strip nobody can see. The scrollbar
 * says you have reached the end; the end is behind the edge.
 *
 * This is what a `min-height` on a `flex-1` child does inside an
 * `overflow-hidden` parent: min-height refuses to shrink, the parent refuses to
 * grow, and the difference is simply cut off. It is invisible on the laptop it
 * was written on, because there the pane is tall enough for the floor to never
 * bind. Only a short viewport — a phone, a tablet held upright — makes it show,
 * and only in a real browser: jsdom has no layout, so `scrollHeight` and
 * `clientHeight` there are both 0 and every viewport looks identical.
 *
 * The rule measures the scroller against every ancestor that clips it, and
 * reports how many pixels of its own viewport it cannot use.
 */
export async function scrollersCanReachTheirEnd(
  page: Page,
): Promise<{ findings: Finding[]; examined: number }> {
  return page.evaluate(() => {
    const out: Finding[] = [];
    let examined = 0;

    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const cs = getComputedStyle(el);
      const scrolls = cs.overflowY === "auto" || cs.overflowY === "scroll";
      if (!scrolls) continue;

      const box = el.getBoundingClientRect();
      if (box.width < 40 || box.height < 40) continue;      // not a reading surface
      if (cs.display === "none" || cs.visibility === "hidden") continue;

      // Only scrollers with something to scroll TO. A short list that fits has
      // no last line to lose.
      if (el.scrollHeight <= el.clientHeight + 4) continue;

      // Where the frame actually ends: the nearest ancestor that clips, and the
      // window itself. Both cut the same way.
      let bottom = innerHeight;
      let culprit = "the screen";
      let p = el.parentElement;
      while (p) {
        const ps = getComputedStyle(p);
        if (ps.overflowY !== "visible") {
          const c = p.getBoundingClientRect();
          if (c.bottom < bottom) {
            bottom = c.bottom;
            culprit = p.className ? `.${String(p.className).split(/\s+/)[0]}` : `<${p.tagName.toLowerCase()}>`;
          }
        }
        p = p.parentElement;
      }

      examined += 1;

      const lost = Math.round(box.bottom - bottom);
      if (lost <= 8) continue;                               // sub-pixel / border rounding

      const label =
        el.getAttribute("aria-label") ||
        (el.textContent ?? "").trim().slice(0, 30) ||
        `<${el.tagName.toLowerCase()}>`;

      out.push({
        what: `a scrolling list is taller than the frame that clips it`,
        detail:
          `"${label}" scrolls, but ${lost}px of its own viewport falls outside ${culprit} — ` +
          `whatever you scroll into that strip can never be seen ` +
          `(box ${Math.round(box.height)}px, frame ends at ${Math.round(bottom)}px)`,
      });
    }

    return { findings: out, examined };
  });
}

/**
 * EVERY CONTROL ON SCREEN CAN BE CALLED BY NAME.
 *
 * A field with no accessible name is announced as "edit text, blank". The label
 * is usually right there on the glass — this app renders `<Label>` 327 times —
 * but a label is only a name once something joins the two, and 322 of those
 * were joined to nothing. So a cashier using a screen reader met a shift-count
 * dialog of four anonymous boxes, in front of the step where a wrong figure
 * becomes a variance somebody gets asked about.
 *
 * Why this rule lives in the BROWSER and not in jsdom, which is where the rest
 * of the naming tests are: the name is COMPUTED. `aria-labelledby` chases ids
 * across the document, a wrapping label contributes its text, `title` is a
 * last resort — and whether a control is on screen at all depends on layout,
 * which jsdom has none of. jsdom can prove the mechanism works on markup it was
 * handed. Only a browser can count the controls a shop is actually looking at.
 *
 * `placeholder` is deliberately NOT a name here, matching
 * `src/common/a11y/useFieldName.ts`: it disappears the moment somebody types,
 * so the field being filled in is exactly the field that has stopped saying
 * what it is. Reporting it as named would make the count agree with axe's
 * laxer check and disagree with the shop.
 *
 * What it implements is the practical subset of accname this app can produce —
 * aria-label, aria-labelledby, label[for], a wrapping label, title, and a
 * button's own text. Not the full specification: `aria-describedby` fallbacks,
 * `<fieldset><legend>` inheritance and slot-assigned text are not modelled.
 * Written down because a scanner whose limits are stated can be trusted about
 * the rest.
 */
export async function everythingHasAName(
  page: Page,
): Promise<{ findings: Finding[]; examined: number; hinted: number }> {
  const result = await page.evaluate(() => {
    const NAMEABLE = 'input:not([type="hidden"]), select, textarea, button, [role="switch"], [role="button"], [role="combobox"], [role="checkbox"], [role="radio"]';

    const text = (el: Element): string => (el.textContent ?? "").replace(/\s+/g, " ").trim();

    const nameOf = (el: HTMLElement): string => {
      const label = el.getAttribute("aria-label");
      if (label !== null && label.trim() !== "") return label.trim();

      const ids = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
      if (ids.length > 0) {
        const joined = ids
          .map((id) => document.getElementById(id))
          .filter((n): n is HTMLElement => n !== null)
          .map(text)
          .join(" ")
          .trim();
        if (joined !== "") return joined;
      }

      if (el.id !== "") {
        for (const l of Array.from(document.querySelectorAll("label[for]"))) {
          if (l.getAttribute("for") === el.id && text(l) !== "") return text(l);
        }
      }

      const wrapping = el.closest("label");
      if (wrapping !== null && text(wrapping) !== "") return text(wrapping);

      // A button names itself with its own content — including an <img alt>.
      if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") {
        if (text(el) !== "") return text(el);
        const alt = el.querySelector("img[alt]")?.getAttribute("alt") ?? "";
        if (alt.trim() !== "") return alt.trim();
      }

      const title = el.getAttribute("title");
      if (title !== null && title.trim() !== "") return title.trim();

      return "";
    };

    const nameless: Array<{ tag: string; where: string; hint: string; classes: string }> = [];
    let examined = 0;
    // Named, but only by its own placeholder text — see nameFromOwnHint in
    // src/common/a11y/useFieldName.ts. Counted apart from the rest because a
    // name borrowed from a hint is second best, and folding it into the pass
    // column would make the total read zero while 27 fields still answer to
    // something nobody chose as their name.
    let hinted = 0;

    for (const el of Array.from(document.querySelectorAll(NAMEABLE)) as HTMLElement[]) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);

      // Only what is on screen and meant to be used. An off-screen control is
      // not something the shop is looking at, and counting it would inflate the
      // denominator with markup nobody can reach.
      if (r.width === 0 || r.height === 0) continue;
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (Number(style.opacity) === 0) continue;
      if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
      if (el.getAttribute("aria-hidden") === "true" || el.closest('[aria-hidden="true"]') !== null) continue;
      if ((el as HTMLInputElement).disabled) continue;

      examined++;
      if (el.hasAttribute("data-name-from-placeholder")) hinted++;
      if (nameOf(el) !== "") continue;

      // Enough to find it again: the tag, the type, and the nearest heading or
      // labelled ancestor. A CSS selector would rot; a description does not.
      const section = el.closest("section, form, [role='dialog'], div[class*='rounded']");
      const heading = section?.querySelector("h1, h2, h3, h4, h5, h6");
      nameless.push({
        tag: el.tagName.toLowerCase() + ((el as HTMLInputElement).type ? `[${(el as HTMLInputElement).type}]` : ""),
        where: heading !== null && heading !== undefined ? text(heading).slice(0, 40) : "no nearby heading",
        // Enough to grep for. "a text input somewhere on the catalog screen" is
        // a finding nobody can act on, and the first version of this rule
        // produced exactly that for three of them.
        hint: (el as HTMLInputElement).placeholder ?? "",
        classes: String(el.className ?? "").split(/\s+/).slice(0, 4).join(" "),
      });
    }

    return { nameless, examined, hinted };
  });

  return {
    examined: result.examined,
    hinted: result.hinted,
    findings: result.nameless.map((n) => ({
      what: `a ${n.tag} has no accessible name`,
      detail: `near "${n.where}"`
        + (n.hint !== "" ? ` · placeholder "${n.hint}"` : "")
        + (n.classes !== "" ? ` · class "${n.classes}"` : "")
        + ` — announced as "${n.tag.startsWith("button") ? "button" : "edit text, blank"}"`,
    })),
  };
}

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

/**
 * A check that belongs to ONE project and declines the others.
 *
 * The reason carries a marker rather than a form of words, because
 * `skipReporter` has to tell an honest project skip from a check that skipped
 * itself out of existence — and it used to do that by pattern-matching English.
 * The day five trade projects arrived with a sentence nobody had thought to
 * match, fifty-two of them were reported as coverage that had quietly vanished.
 */
export function projectOnly(why: string): string {
  return `${BY_PROJECT} ${why}`;
}
