import { useCallback } from "react";

/**
 * THE NAME IS ALREADY ON THE SCREEN.
 *
 * ── What the measurement actually said ──────────────────────────────────
 *
 * The first pass at this recorded "245 form fields have no accessible name"
 * and left it as a backlog item. That framing was wrong, and the wrongness
 * mattered: it made the job sound like writing 245 names.
 *
 * Counting the other side of it:
 *
 *     <Label>   used          327 times
 *     htmlFor   passed          5 times
 *
 * So the labels are there. Every one of them was written by somebody who knew
 * what the field was called, and 322 of them are not attached to anything. A
 * sighted cashier sees "Credit limit" sitting above a box. A cashier using a
 * screen reader hears "edit text, blank" — with the answer rendered two
 * centimetres above it, in the accessibility tree's blind spot.
 *
 * Nothing here needs new words. It needs the words joined up.
 *
 * ── Why at runtime, and not as a prop ───────────────────────────────────
 *
 * The same argument the Modal settled (see components/ui/modal): the name is
 * taken from what the component already renders, because there are hundreds of
 * call sites and they all already render it. Nothing to pass, nothing to
 * forget, and no 465-file sed across every form in the app.
 *
 * The shape is uniform enough to rely on — this is what a form looks like here,
 * everywhere:
 *
 *     <div>
 *       <Label>Sale price (optional)</Label>
 *       <Input value={…} onChange={…} />
 *     </div>
 *
 * Note that `Input` wraps its own `<input>` in a `div.relative`, so the label is
 * not a sibling but an uncle. Hence a walk up rather than a look sideways.
 *
 * ── aria-labelledby, not htmlFor ────────────────────────────────────────
 *
 * Stamping `for` on the label would also make clicking it focus the field,
 * which is genuinely nicer. It is not what this does. `for` CHANGES BEHAVIOUR —
 * on a checkbox, a click on the label starts toggling it — and this runs on
 * every field in the product form, the tender pane, the tank dip sheet and the
 * shift count. A sweep this wide earns its keep by being purely additive: the
 * accessibility tree gains a name and not one pointer event moves.
 *
 * Where a field wants the click target too, that is a real `<Label htmlFor>`
 * and an `id`, decided at the call site.
 *
 * ── A WRONG NAME IS WORSE THAN NO NAME ──────────────────────────────────
 *
 * This is the whole reason the walk below is as fussy as it is, and it is worth
 * saying plainly: a field announced as "Opening float" that actually holds the
 * closing count is not an improvement on an unnamed field. It is a field that
 * lies, and it lies specifically to the person who has no way to check it.
 *
 * So every ambiguity ends the walk with no name rather than a guess:
 *
 *   · an ancestor holding more than one control  → stop. Which label belongs to
 *     which control is not knowable from the DOM, and `<div><Label>Price</Label>
 *     <Input/><Input/></div>` would hand both inputs the word "Price".
 *   · a label that already has `for`             → skip it. It is spoken for.
 *   · a label that CONTAINS a control            → skip it. That is the wrapping
 *     `<label><input/>Cash</label>` shape, which already names its own child.
 *   · a label after the control in document order → skip it. Labels sit above
 *     fields in this app; one below is a hint or the next field's label.
 *   · nothing found within three levels          → stop. Beyond that a "nearby"
 *     label is just the nearest word on the page.
 */

/** Controls whose name we are trying to establish, and which count as "a control". */
const CONTROLS = "input, select, textarea, [role='switch'], [role='combobox']";

/** How far up to look before "nearby" stops meaning anything. */
const MAX_DEPTH = 3;

/**
 * Does this element already have a name? Then leave it entirely alone.
 *
 * Deliberately does NOT count `placeholder`. A placeholder is not a name: it
 * disappears the moment somebody types, so the field a person is filling in is
 * precisely the field that has stopped saying what it is.
 */
function alreadyNamed(el: HTMLElement): boolean {
  if (el.getAttribute("aria-label") !== null) return true;
  if (el.getAttribute("aria-labelledby") !== null) return true;

  // A real `<Label htmlFor>` tied to this id, or a `<label>` wrapped round it.
  if (el.id !== "" && el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`) !== null) {
    return true;
  }

  return el.closest("label") !== null;
}

function usable(label: HTMLLabelElement, control: HTMLElement): boolean {
  if (label.hasAttribute("for")) return false;
  if (label.querySelector(CONTROLS) !== null) return false;
  if (label.textContent === null || label.textContent.trim() === "") return false;

  // Above the field, not below it. `DOCUMENT_POSITION_FOLLOWING` means the
  // control comes after the label, which is the layout this app uses.
  return (label.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** Joins a control to the label already sitting above it. Returns the id used, or null. */
export function nameFromNearbyLabel(control: HTMLElement | null): string | null {
  if (control === null || alreadyNamed(control)) return null;

  let next: HTMLElement | null = control.parentElement;

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const scope = next;
    if (scope === null) break;
    next = scope.parentElement;

    // More than one control in here and the labels become anybody's guess.
    if (scope.querySelectorAll(CONTROLS).length > 1) return null;

    const label = [...scope.querySelectorAll("label")].find((l) => usable(l, control));
    if (label === undefined) continue;

    if (label.id === "") {
      // Not `useId()`: this runs from a ref callback against a node that may
      // outlive the render that created it, and the id has to be stable for as
      // long as the pairing is. A counter off the document is both.
      const n = control.ownerDocument.querySelectorAll("[data-named-by-label]").length;
      label.id = `named-label-${n}-${Math.trunc(performance.now())}`;
    }

    control.setAttribute("aria-labelledby", label.id);
    control.setAttribute("data-named-by-label", "");

    return label.id;
  }

  return null;
}

/**
 * LAST RESORT: the author's own hint, promoted to a real name.
 *
 * There are 27 search boxes in this app of the shape `<Input placeholder="Search
 * products…" />` — no label, because the placeholder IS the affordance. A
 * browser-side count found ten of them visible at once with no accessible name
 * at all, so they were announced as "edit text, blank": the one control on a
 * list screen whose whole job is to be found.
 *
 * This looks like a contradiction of the rule above it and is not, so the
 * distinction is worth being exact about. The objection to a placeholder is that
 * it is **not there when you need it** — it clears the moment somebody types, so
 * the field being filled in is the field that has stopped saying what it is.
 * Copying the text into `aria-label` removes precisely that problem: the
 * attribute does not clear.
 *
 * What it cannot fix is a hint that was never a name. `placeholder="e.g. T-Shirt
 * / Haircut"` is an EXAMPLE, and a field called "e.g. T-Shirt / Haircut" is
 * absurd. That case is already handled by ordering: a real label wins, and the
 * product-name field has one. This only ever fires where nothing else named the
 * control — which is, in practice, the search boxes.
 *
 * ── Why it marks itself ─────────────────────────────────────────────────
 *
 * `data-name-from-placeholder` is not decoration. A name derived from a hint is
 * second best, and quietly converting one into the other would make the app's
 * accessible-name count go to zero while leaving 27 fields named by something
 * that was never chosen as a name. So the browser rule in `e2e/rules.ts` counts
 * these SEPARATELY, with their own budget: nothing is hidden, and the softer
 * category is visible for anybody who wants to write the real names.
 */
function nameFromOwnHint(control: HTMLElement): boolean {
  const hint = control.getAttribute("placeholder");
  if (hint === null) return false;

  const words = hint.trim();
  // Not "—", not "0", not a stray colon: those are formatting, not a name.
  if (words.length < 3 || /^[^\p{L}\p{N}]+$/u.test(words)) return false;

  control.setAttribute("aria-label", words);
  control.setAttribute("data-name-from-placeholder", "");

  return true;
}

/**
 * A ref for a control that should answer to whatever label is above it.
 *
 * Runs in the ref callback rather than an effect on purpose: by the time a ref
 * fires the node is in the document and its siblings are painted, and the name
 * is attached before a reader has been handed the field.
 */
export function useFieldName(): (el: HTMLElement | null) => void {
  return useCallback((el: HTMLElement | null) => {
    if (el === null || alreadyNamed(el)) return;
    if (nameFromNearbyLabel(el) !== null) return;

    nameFromOwnHint(el);
  }, []);
}
