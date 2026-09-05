import { toast, useToastStore } from "../src/common/ui/toast";

const shown = () => useToastStore.getState().toasts;

beforeEach(() => useToastStore.getState().clear());

describe("toasts", () => {
  it("shows what it was given, with the kind it was raised as", () => {
    toast.error("Couldn't place your order", { detail: "The shop is closed." });

    expect(shown()).toHaveLength(1);
    expect(shown()[0]).toMatchObject({
      kind: "error",
      message: "Couldn't place your order",
      detail: "The shop is closed.",
    });
  });

  it("gives an error longer on screen than a success", () => {
    toast.success("Added");
    toast.error("Failed");

    const [ok, bad] = shown();
    // A success is glanced at; an error is read, and often while the person is
    // deciding what to do about it.
    expect(bad.duration).toBeGreaterThan(ok.duration);
  });

  it("does not repeat itself", () => {
    // One event the app noticed twice — a retry, a double tap, two queued rows
    // failing for one reason. The second copy tells the reader nothing and
    // costs them a slot.
    toast.error("No internet");
    toast.error("No internet");

    expect(shown()).toHaveLength(1);
  });

  it("treats a different detail as a different message", () => {
    toast.error("Couldn't save", { detail: "Item 1" });
    toast.error("Couldn't save", { detail: "Item 2" });

    expect(shown()).toHaveLength(2);
  });

  it("keeps the newest three and drops the oldest", () => {
    ["a", "b", "c", "d"].forEach((m) => toast.info(m));

    // A sync flushing a failed queue can raise six at once; the person is
    // waiting on the newest, and the sixth must not bury it.
    expect(shown().map((t) => t.message)).toEqual(["b", "c", "d"]);
  });

  it("dismisses the one it was asked to, not whichever is on top", () => {
    const first = toast.info("first");
    toast.info("second");

    toast.dismiss(first);

    expect(shown().map((t) => t.message)).toEqual(["second"]);
  });

  it("survives dismissing something already gone", () => {
    const id = toast.info("gone");
    toast.dismiss(id);

    // The exit animation and a tap race each other by design; the loser must
    // not remove whichever toast has since taken that slot.
    expect(() => toast.dismiss(id)).not.toThrow();
    expect(shown()).toHaveLength(0);
  });

  it("can be raised from outside React", () => {
    // The reason this is a store and not a hook: a mutation's onError is a
    // plain callback with no component around it.
    const onError = () => toast.error("Request failed");
    onError();

    expect(shown()).toHaveLength(1);
  });
});
