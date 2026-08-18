import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { CategoryTree, type TreeHandlers } from "./CategoryTree";
import type { Category } from "../types";

/** The item count is a link into Products, so the tree needs a router. */
const render = (ui: React.ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

/**
 * The wiring around the drag, which is where this went wrong twice.
 *
 * `reorder.test.ts` pins the arithmetic. This pins that the arithmetic is
 * actually reached: the first version listened for pointer moves on an overlay
 * while the grip had CAPTURED the pointer, so every event went to the grip and
 * the overlay heard nothing — a drag that measured perfectly and never fired.
 *
 * jsdom has no layout and no pointer capture, so both are supplied below. That
 * makes this a test of the wiring rather than of the browser, which is exactly
 * what it is for.
 */

const ROW_HEIGHT = 40;

const cat = (id: string, name: string, over: Partial<Category> = {}): Category => ({
  id,
  parent_id: null,
  name,
  sort_order: 0,
  is_active: true,
  ...over,
});

const handlers = (over: Partial<TreeHandlers> = {}): TreeHandlers => ({
  onRename: vi.fn(),
  onToggleVisible: vi.fn(),
  onAddSub: vi.fn(),
  onDelete: vi.fn(),
  onReorder: vi.fn(),
  busy: false,
  canReorder: true,
  ...over,
});

beforeEach(() => {
  // Pointer capture is how the grip keeps hearing the finger once it has left
  // the button. jsdom does not implement it.
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();

  // Give the rows a height, in document order, so midpoints are 20 / 60 / 100.
  let nth = 0;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const top = (this as HTMLElement).hasAttribute("data-row") ? nth++ * ROW_HEIGHT : 0;

    return {
      top,
      bottom: top + ROW_HEIGHT,
      height: ROW_HEIGHT,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

/** Drag the grip of `name` to a pointer position of `y`. */
function drag(name: string, y: number): void {
  const grip = screen.getByLabelText(`Reorder ${name}`);
  fireEvent.pointerDown(grip, { clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(grip, { clientY: y, pointerId: 1 });
  fireEvent.pointerUp(grip, { pointerId: 1 });
}

const three = [cat("a", "Drinks"), cat("b", "Bakery"), cat("c", "Cleaning")];

describe("reordering a category by dragging it", () => {
  it("writes the new order, numbered from zero", () => {
    const h = handlers();
    render(<CategoryTree roots={three} handlers={h} />);

    // Past the middle of the second row (60) → lands after Bakery.
    drag("Drinks", 70);

    expect(h.onReorder).toHaveBeenCalledWith([
      { id: "b", parent_id: null, sort_order: 0 },
      { id: "a", parent_id: null, sort_order: 1 },
      { id: "c", parent_id: null, sort_order: 2 },
    ]);
  });

  it("says nothing when the grip is only tapped", () => {
    // A mis-touch on a till must not write the same order back to the server.
    const h = handlers();
    render(<CategoryTree roots={three} handlers={h} />);

    const grip = screen.getByLabelText("Reorder Drinks");
    fireEvent.pointerDown(grip, { clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(grip, { pointerId: 1 });

    expect(h.onReorder).not.toHaveBeenCalled();
  });

  it("moves a row with the arrow keys, because a grip is not reachable by keyboard", () => {
    const h = handlers();
    render(<CategoryTree roots={three} handlers={h} />);

    fireEvent.keyDown(screen.getByLabelText("Reorder Cleaning"), { key: "ArrowUp" });

    expect(h.onReorder).toHaveBeenCalledWith([
      { id: "a", parent_id: null, sort_order: 0 },
      { id: "c", parent_id: null, sort_order: 1 },
      { id: "b", parent_id: null, sort_order: 2 },
    ]);
  });

  it("refuses to move the top row up or the bottom row down", () => {
    const h = handlers();
    render(<CategoryTree roots={three} handlers={h} />);

    fireEvent.keyDown(screen.getByLabelText("Reorder Drinks"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByLabelText("Reorder Cleaning"), { key: "ArrowDown" });

    expect(h.onReorder).not.toHaveBeenCalled();
  });

  it("will not reorder a FILTERED list, which would renumber what is hidden", () => {
    // `sort_order` is written as each row's position from zero. Do that to a
    // filtered list and the hidden rows keep their old numbers while the
    // visible ones are renumbered on top of them — a shop drags one category
    // and silently reshuffles the ones it could not see.
    const h = handlers({ canReorder: false });
    render(<CategoryTree roots={three} handlers={h} />);

    expect(screen.queryByLabelText("Reorder Drinks")).not.toBeInTheDocument();
    expect(h.onReorder).not.toHaveBeenCalled();
  });

  it("does not start a drag while a write is already in flight", () => {
    const h = handlers({ busy: true });
    render(<CategoryTree roots={three} handlers={h} />);

    drag("Drinks", 70);

    expect(h.onReorder).not.toHaveBeenCalled();
  });
});

describe("subcategories", () => {
  const nested = [
    cat("a", "Drinks", {
      children: [cat("a1", "Juices", { parent_id: "a" }), cat("a2", "Tea", { parent_id: "a" })],
    }),
    cat("b", "Bakery"),
  ];

  it("shows what is inside without being asked", () => {
    render(<CategoryTree roots={nested} handlers={handlers()} />);

    expect(screen.getByText("Juices")).toBeInTheDocument();
    expect(screen.getByText("Tea")).toBeInTheDocument();
  });

  it("collapses, and says how many it is hiding", () => {
    // Collapsing must never make a branch look like a leaf — otherwise a
    // shopkeeper tidies the list and loses track of what is under it.
    render(<CategoryTree roots={nested} handlers={handlers()} />);

    fireEvent.click(screen.getByLabelText("Collapse Drinks"));

    expect(screen.queryByText("Juices")).not.toBeInTheDocument();
    expect(screen.getByText("2 inside")).toBeInTheDocument();
  });

  it("gives a leaf no twisty to press", () => {
    render(<CategoryTree roots={nested} handlers={handlers()} />);

    expect(screen.queryByLabelText("Collapse Bakery")).not.toBeInTheDocument();
  });

  it("keeps a drag inside its own sibling group", () => {
    // `sort_order` only means anything under one parent. A drag that could
    // cross parents would be a MOVE, which is a different operation with
    // different consequences for the products underneath.
    const h = handlers();
    render(<CategoryTree roots={nested} handlers={h} />);

    fireEvent.keyDown(screen.getByLabelText("Reorder Tea"), { key: "ArrowUp" });

    expect(h.onReorder).toHaveBeenCalledWith([
      { id: "a2", parent_id: "a", sort_order: 0 },
      { id: "a1", parent_id: "a", sort_order: 1 },
    ]);
  });
});

describe("the row itself", () => {
  it("marks a hidden category rather than dropping it", () => {
    render(<CategoryTree roots={[cat("a", "Drinks", { is_active: false })]} handlers={handlers()} />);

    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("counts items in words that survive the number one", () => {
    render(
      <CategoryTree
        roots={[cat("a", "Drinks", { products_count: 1 }), cat("b", "Bakery", { products_count: 4 })]}
        handlers={handlers()}
      />,
    );

    expect(screen.getByText("1 item")).toBeInTheDocument();
    expect(screen.getByText("4 items")).toBeInTheDocument();
  });

  it("makes the item count a way into those items", () => {
    render(<CategoryTree roots={[cat("a", "Drinks", { products_count: 4 })]} handlers={handlers()} />);

    expect(screen.getByText("4 items").closest("a")).toHaveAttribute(
      "href",
      "/tenant/products?category=a",
    );
  });

  it("renames on Enter without reaching for the mouse", () => {
    const h = handlers();
    render(<CategoryTree roots={[cat("a", "Drinks")]} handlers={h} />);

    fireEvent.click(screen.getByText("Rename"));
    const field = screen.getByDisplayValue("Drinks");
    fireEvent.change(field, { target: { value: "Cold drinks" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(h.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), "Cold drinks");
  });
});
