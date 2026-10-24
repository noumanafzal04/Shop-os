/**
 * DOES THIS ITEM FIT THE CAR ON THE RAMP?
 *
 * A tyre carries its size in its own name — "Yokohama 195/65 R15", "195/65R15
 * Dunlop", "Tyre 195 65 15" — so the size's numbers are matched in order with
 * anything between them. The same rule as the server's `tyre_size` filter
 * (CustomerVehicle::tyreSizeLike), so the till finds the same tyres online and
 * offline. Text with fewer than two numbers is no size, and matches everything.
 */
export function fitsTyreSize(text: string, size: string): boolean {
  const numbers = size.match(/\d+/g) ?? [];
  if (numbers.length < 2) return true;

  return new RegExp(numbers.join(".*")).test(text);
}
