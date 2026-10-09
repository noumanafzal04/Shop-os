/**
 * A face for somebody who has no photograph: their initials, in a colour that
 * is theirs.
 *
 * The colour is worked out from the name, so the same person is the same
 * colour on every screen and on every visit — which is the point. A list of
 * forty people in forty grey circles is forty names to read; one where Farhan
 * is always orange is a list you find Farhan in.
 */
export type Tone = "brand" | "green" | "amber" | "red" | "sky" | "orange" | "purple" | "slate";

/** Slate is left out: it is the colour of "nothing to say", not of a person. */
const FACES: Tone[] = ["brand", "green", "sky", "orange", "purple", "amber", "red"];

export function toneFor(name: string): Tone {
  let sum = 0;
  for (const ch of name.trim().toLowerCase()) sum = (sum * 31 + ch.charCodeAt(0)) % 9973;

  return FACES[sum % FACES.length];
}

/** First and last word: "Muhammad Ali Khan" is MK, the way a person abbreviates it. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";

  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}
