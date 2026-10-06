import type { TextareaHTMLAttributes } from "react";
import { useFieldName } from "./useFieldName";

/**
 * A plain `<textarea>` that answers to the label above it.
 *
 * `InputField`, `Select` and the shared `TextArea` all join themselves to the
 * label a form already renders. Four places wrote a raw `<textarea>` instead —
 * for a monospace chart, a list typed one to a line, a block of printed terms
 * — and so skipped it: the label sat above the box and a screen reader
 * announced the box by its PLACEHOLDER, which is an example, not a name
 * ("edit text, Prices valid for the period shown").
 *
 * Use this wherever the shared `TextArea`'s own chrome is not wanted. There
 * is a rule that no raw `<textarea>` is left in the app (see the test beside
 * this file), because the next one would be unnamed in exactly the same way.
 */
export function NamedTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const nameRef = useFieldName();

  return <textarea ref={nameRef} {...props} />;
}
