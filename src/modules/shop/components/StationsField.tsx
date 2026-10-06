import { useEffect, useState } from "react";
import { NamedTextarea } from "../../../common/a11y/NamedTextarea";

/** One name to a line; blank lines and stray spaces at the ends are not names. */
export const stationsFrom = (text: string): string[] =>
  text.split("\n").map((line) => line.trim()).filter(Boolean);

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Kitchen stations, typed one to a line.
 *
 * ── Why the box keeps its own text ───────────────────────────────────
 *
 * The box used to show `stations.join("\n")` and, on every keystroke, turn
 * what was typed straight back into a list: split, trim, drop the empties.
 * So the moment you pressed Enter the new, empty line was "an empty", was
 * dropped, and the box redrew without it — there was no way to type a second
 * station. A space had the same fate at the end of a word, so "Hot Grill"
 * came out "HotGrill". The only way to enter two stations was to paste them.
 *
 * What is being TYPED and what it MEANS are two things. The box holds the
 * text exactly as typed; the list is worked out from it and handed up.
 */
export function StationsField({ value, onChange, className, placeholder }: {
  value: readonly string[];
  onChange: (stations: string[]) => void;
  className?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(() => value.join("\n"));

  // The list changed underneath — saved elsewhere, or reset. Redraw from it,
  // but only when it MEANS something different from what is in the box:
  // otherwise this would eat the Enter all over again.
  useEffect(() => {
    setText((typed) => (same(stationsFrom(typed), value) ? typed : value.join("\n")));
  }, [value]);

  return (
    <NamedTextarea
      rows={3}
      className={className}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(stationsFrom(e.target.value));
      }}
    />
  );
}
