/**
 * THE RATE BESIDE THE MONEY IS THE RATE THE MONEY WAS CHARGED AT (next rounds #28).
 *
 * A shop's detail said "6.5% · Rs 10,947.75 not yet billed across 30 orders"
 * where the 10,947.75 was 4.5% of the base — every charge is stamped with the
 * rate of the day its order was placed, and the platform rate had moved since.
 * An admin who checked was out by Rs 4,865.58 with nothing on screen to say why.
 *
 * So the heading names today's rate as what NEW orders pay, and, when the
 * waiting charges were raised at another rate, says that rate too.
 */
export function outstandingHeading(
  effectiveRate: number,
  outstanding: { orders: number; base: number; amount: number },
  money: (n: number) => string,
): string {
  const orders = `${outstanding.orders} order${outstanding.orders === 1 ? "" : "s"}`;
  const chargedAt = outstanding.base > 0 ? Math.round((outstanding.amount / outstanding.base) * 10000) / 100 : effectiveRate;
  const differs = outstanding.orders > 0 && Math.abs(chargedAt - effectiveRate) >= 0.01;

  return `New orders ${effectiveRate}% · ${money(outstanding.amount)} not yet billed across ${orders}${differs ? `, charged at ${chargedAt}% of ${money(outstanding.base)}` : ""}`;
}
