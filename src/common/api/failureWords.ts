/**
 * WHAT A FAILED WRITE TELLS A PERSON (next rounds #30, #31).
 *
 * A refusal the shop can act on comes with its own sentence. A server that
 * broke does not: Laravel sends the bare reason phrase, a gateway sends an HTML
 * page, and the screen printed "Sale failed · Server Error", "· Service
 * Unavailable", "· Request failed." — none of it saying the two true things a
 * cashier needs: nothing was taken, and the cart is still there.
 *
 * A 429 printed "Too Many Attempts." and let Complete be pressed again at once,
 * into the same throttle, though the answer said how long to wait.
 *
 * Null when the server's own words stand: a refusal with a code, a validation
 * error, anything below 500 that is not a throttle or a lapsed sign-in.
 */
export function failureWords(
  status: number | undefined,
  body: { message?: unknown; meta?: { error_code?: unknown } } | undefined,
  retryAfter: string | null | undefined,
  now: number = Date.now(),
): { message: string; code: string; meta: Record<string, unknown> } | null {
  if (status === undefined) return null;
  const said = typeof body?.message === "string" ? body.message : null;
  const coded = typeof body?.meta?.error_code === "string";

  if (status === 429) {
    const seconds = waitFor(retryAfter, now);

    return {
      message: `Too many tries in a short time — wait ${seconds} seconds, then try again. Nothing was saved.`,
      code: "TOO_MANY_ATTEMPTS",
      meta: { retry_after: seconds },
    };
  }

  if (status >= 500 && !coded) {
    return {
      message: "The server could not finish this, so nothing was saved — what you entered is still here. Try again in a moment.",
      code: "SERVER_FAILED",
      meta: {},
    };
  }

  if (status === 401 && !coded && (said === null || said === "Unauthenticated.")) {
    return { message: "Your sign-in has run out, so nothing was saved. Sign in again to carry on.", code: "SIGNED_OUT", meta: {} };
  }

  if (status >= 400 && said === null && !coded) {
    return {
      message: "The server answered with something this screen cannot read, so nothing was saved. Try again in a moment.",
      code: "UNREADABLE_ANSWER",
      meta: {},
    };
  }

  return null;
}

/** Retry-After is seconds or a date; a missing or unreadable one waits 30 seconds. */
function waitFor(header: string | null | undefined, now: number): number {
  const seconds = Number(header);
  if (header && Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  const at = header ? Date.parse(header) : NaN;

  return Number.isFinite(at) && at > now ? Math.ceil((at - now) / 1000) : 30;
}
