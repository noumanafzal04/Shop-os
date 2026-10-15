/**
 * WHETHER A "WHAT WILL THIS COME TO" QUESTION HAS ANYTHING IN IT.
 *
 * The sale and order sheets ask the server what the bill comes to, a moment
 * after the last tap (a debounced copy of the bill). The switch that let them
 * ask was read off the bill NOW, the question off the bill a moment ago — so
 * the first line added sent the empty bill before it, and the server answered
 * 422 "The items field is required" on every exchange (tester pass 4, B52) and
 * on opening Take order (pass 1, B27).
 *
 * The question itself is the thing to read: a bill with no lines is not asked.
 */
export function asksAbout(asked: string): boolean {
  try {
    const items = (JSON.parse(asked) as { items?: unknown }).items;

    return Array.isArray(items) && items.length > 0;
  } catch {
    return false;
  }
}
