import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import TextArea from "../../components/form/input/TextArea";
import Select from "../../components/form/Select";

/**
 * Can the shop's forms be read by somebody who cannot see them?
 *
 * jsdom is the right tool for this and it is worth saying why, because this repo
 * has learned the hard way that jsdom lies about anything involving layout — no
 * geometry, no stylesheets, `navigator.onLine` permanently true. An accessible
 * NAME is none of those things. It is a relationship between two nodes in the
 * document, which is exactly what jsdom does model, and testing-library's
 * `getByLabelText` resolves `aria-labelledby` the way a reader does.
 *
 * What jsdom still cannot tell us is whether the name is the RIGHT one on a real
 * screen at a real size — so `e2e/chrome.spec.ts` counts the app's live controls
 * in a browser. This file proves the mechanism; that one proves the coverage.
 */

describe("a field answers to the label above it", () => {
  it("finds the label rendered as its sibling", () => {
    render(
      <div>
        <Label>Sale price (optional)</Label>
        <Input value="" onChange={() => {}} />
      </div>,
    );

    // The shape of nearly every form in this app, and until now the name was
    // visible on screen and absent from the accessibility tree.
    expect(screen.getByLabelText("Sale price (optional)")).toBeTruthy();
  });

  it("reads a label that has markup inside it", () => {
    render(
      <div>
        <Label>
          Name <span>*</span>
        </Label>
        <Input value="" onChange={() => {}} />
      </div>,
    );

    // Required-field asterisks are spans, so the name is assembled from the
    // label's whole subtree rather than its first text node.
    expect(screen.getByLabelText(/Name/)).toBeTruthy();
  });

  it("works for a select and a textarea, not only a text box", () => {
    render(
      <div>
        <div>
          <Label>Category</Label>
          <Select options={[{ value: "a", label: "A" }]} onChange={() => {}} />
        </div>
        <div>
          <Label>Complaint</Label>
          <TextArea value="" onChange={() => {}} />
        </div>
      </div>,
    );

    expect(screen.getByLabelText("Category")).toBeTruthy();
    expect(screen.getByLabelText("Complaint")).toBeTruthy();
  });

  it("leaves an explicit aria-label alone", () => {
    render(
      <div>
        <Label>Whatever is above it</Label>
        <Input aria-label="Scan a barcode" value="" onChange={() => {}} />
      </div>,
    );

    expect(screen.getByLabelText("Scan a barcode")).toBeTruthy();
    expect(screen.queryByLabelText("Whatever is above it")).toBeNull();
  });

  it("leaves a real htmlFor pairing alone", () => {
    render(
      <div>
        <Label htmlFor="credit">Credit limit</Label>
        <Input id="credit" value="" onChange={() => {}} />
      </div>,
    );

    // One name, not two: the field must not end up labelled twice over.
    const field = screen.getByLabelText("Credit limit");
    expect(field.getAttribute("aria-labelledby")).toBeNull();
  });
});

describe("and gives up rather than guessing", () => {
  it("names nothing when one label sits over two fields", () => {
    render(
      <div>
        <Label>Price</Label>
        <Input value="" onChange={() => {}} />
        <Input value="" onChange={() => {}} />
      </div>,
    );

    // THE load-bearing case. Handing both boxes the word "Price" would announce
    // a name that is wrong for at least one of them, and a field that lies is
    // worse than a field that says nothing — the person it lies to is precisely
    // the person with no way to check it.
    expect(screen.queryByLabelText("Price")).toBeNull();
  });

  it("ignores a label that is spoken for", () => {
    render(
      <div>
        <Label htmlFor="somewhere-else">Opening float</Label>
        <Input value="" onChange={() => {}} />
      </div>,
    );

    expect(screen.queryByLabelText("Opening float")).toBeNull();
  });

  it("ignores a label that wraps its own control", () => {
    render(
      <div>
        <label>
          <input type="checkbox" /> Cash
        </label>
        <Input value="" onChange={() => {}} />
      </div>,
    );

    // "Cash" belongs to the checkbox it contains. The text box below it is a
    // different question and must not borrow the answer.
    const boxes = screen.getAllByLabelText("Cash");
    expect(boxes).toHaveLength(1);
    expect((boxes[0] as HTMLInputElement).type).toBe("checkbox");
  });

  it("ignores a label that comes after the field", () => {
    render(
      <div>
        <Input value="" onChange={() => {}} />
        <Label>Next question</Label>
      </div>,
    );

    expect(screen.queryByLabelText("Next question")).toBeNull();
  });

  it("does not reach past three levels for a name", () => {
    render(
      <div>
        <Label>Something far away</Label>
        <div>
          <div>
            <div>
              <div>
                <Input value="" onChange={() => {}} />
              </div>
            </div>
          </div>
        </div>
      </div>,
    );

    // Beyond a few levels "the label nearby" stops meaning anything and becomes
    // "the nearest words on the page".
    expect(screen.queryByLabelText("Something far away")).toBeNull();
  });

  it("never lets a placeholder outrank a real label", () => {
    render(
      <div>
        <Label>Name</Label>
        <Input placeholder="e.g. T-Shirt / Haircut" value="" onChange={() => {}} />
      </div>,
    );

    // THE priority that makes the placeholder fallback safe to have at all.
    // "e.g. T-Shirt / Haircut" is an EXAMPLE, and a field called that is
    // absurd — so the label above it has to win every time one exists.
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.queryByLabelText("e.g. T-Shirt / Haircut")).toBeNull();
  });

  it("falls back to the placeholder only when nothing else names the field", () => {
    render(<Input placeholder="Search products…" value="" onChange={() => {}} />);

    // The 27 search boxes: no label, because the placeholder IS the affordance.
    // Announced as "edit text, blank" before this, which is the one control on
    // a list screen whose whole job is to be found.
    //
    // The original objection to a placeholder still stands and is answered by
    // the mechanism rather than avoided: a placeholder clears when you type, an
    // `aria-label` copied from it does not. It is marked as second-best so the
    // browser rule can count these apart from properly-named controls.
    const field = screen.getByLabelText("Search products…");
    expect(field.getAttribute("data-name-from-placeholder")).toBe("");
  });

  it("will not take a placeholder that is only punctuation", () => {
    // The declared-tender boxes use "—" as a placeholder. A field announced as
    // "—" is no better than one announced as blank, and worse than honest.
    render(<Input placeholder="—" value="" onChange={() => {}} />);

    expect(screen.queryByLabelText("—")).toBeNull();
  });
});
