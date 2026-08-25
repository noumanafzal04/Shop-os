import { cartTotal, rupees, TRADE_CART } from "./tradeCarts";
import { TRADE_ICON, type TradeCode } from "./tradeIcon";

/**
 * THE HERO'S ONE PICTURE: a till ringing a sale, with the line down.
 *
 * Not a screenshot. A screenshot of a POS at hero size is unreadable, ages the
 * moment a button moves, and needs a second one for dark mode. This is the
 * till reduced to the four things a shopkeeper looks for — what went in, what
 * it costs, that it is still working offline, and that the money is counted.
 *
 * It stands on a near-black band on purpose. The pitch is a shop whose lights
 * have gone and whose counter has not, so the one lit thing on the screen
 * should be the till. Everything around it is dark; this glows.
 *
 * The trade is a prop because the page's other claim — that it knows a
 * pharmacy from a tyre shop — is only worth making if you can watch the till
 * change. Same component, same layout, different trade: that is the evidence.
 */
export function TillMock({ trade, className = "", compact = false }: {
  trade: TradeCode;
  className?: string;
  /**
   * The corner-of-the-hero size: narrower, two lines instead of three, and no
   * glow of its own. It sits ON the app window there, and a second soft light
   * behind a card that is already lit reads as a smudge rather than as depth.
   */
  compact?: boolean;
}) {
  const cart = TRADE_CART[trade];
  const Icon = TRADE_ICON[trade];
  const total = cartTotal(cart);
  const lines = compact ? cart.lines.slice(0, 2) : cart.lines;

  return (
    <div className={`relative ${className}`}>
      {/* The light the card throws. Decorative, and hidden from the reader. */}
      {!compact && (
        <div
          aria-hidden="true"
          className="absolute -inset-10 -z-10 rounded-[4rem] bg-brand-500/25 blur-[80px]"
        />
      )}

      <div className={`relative overflow-hidden bg-pos-ground shadow-[0_40px_90px_-20px_rgba(0,0,0,0.65)] ring-1 ring-white/15 ${
        compact ? "rounded-2xl" : "rounded-3xl"
      }`}>
        {/* The lit edge along the top — a screen that is on. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent"
        />

        {/* Till header — which register, and the state of the line. */}
        <div className={`flex items-center justify-between gap-3 border-b border-white/10 ${
          compact ? "px-3.5 py-2.5" : "px-5 py-4"
        }`}>
          <div className="flex min-w-0 items-center gap-3">
            <span className={`flex shrink-0 items-center justify-center rounded-xl bg-brand-500/20 text-brand-300 ${
              compact ? "h-7 w-7" : "h-9 w-9"
            }`}>
              <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
            </span>
            <div className="min-w-0">
              <p className={`truncate font-semibold text-white ${compact ? "text-[13px]" : "text-sm"}`}>
                {cart.register}
              </p>
              {!compact && <p className="truncate text-[11px] text-white/45">{cart.label}</p>}
            </div>
          </div>

          {/* THE POINT OF THE WHOLE PICTURE. */}
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-warning-500/15 px-2.5 py-1 text-[11px] font-semibold text-warning-400 ring-1 ring-warning-500/25">
            <span className="h-1.5 w-1.5 rounded-full bg-warning-400" />
            Offline
          </span>
        </div>

        {/* The cart. Each line arrives after the one above it — and the whole
            set re-keys on the trade, so switching trade rings the sale again. */}
        <div className={compact ? "space-y-1 p-2.5" : "space-y-1.5 p-3.5"}>
          {lines.map((line, i) => (
            <div
              key={`${trade}-${line.name}`}
              className={`rings-up flex items-center justify-between gap-3 bg-pos-card ${
                compact ? "rounded-xl px-3 py-2" : "rounded-2xl px-4 py-3"
              }`}
              style={{ "--ring-delay": `${120 + i * 130}ms` } as React.CSSProperties}
            >
              <div className="min-w-0">
                <p className={`truncate font-semibold text-gray-900 ${compact ? "text-[12.5px]" : "text-sm"}`}>
                  {line.name}
                </p>
                <p className="text-[11px] text-gray-500">{line.qty}</p>
              </div>
              <span className={`shrink-0 font-semibold tabular-nums text-gray-900 ${
                compact ? "text-[12.5px]" : "text-sm"
              }`}>
                Rs {rupees(line.price)}
              </span>
            </div>
          ))}

          {/* THE LINE ONLY THIS TRADE HAS. A batch number, a meter reading, a
              KOT — the till's own answer to "does it understand my shop".

              Not at the compact size: there it stands ON the app window, and
              every row it grows by is a row of the console it hides. The trade
              switcher further down the page makes this point properly. */}
          {!compact && <div
            key={`${trade}-note`}
            className={`rings-up flex items-center gap-2.5 border border-dashed border-white/15 ${
              compact ? "rounded-xl px-3 py-2" : "rounded-2xl px-4 py-2.5"
            }`}
            style={{ "--ring-delay": `${120 + lines.length * 130}ms` } as React.CSSProperties}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
            <p className="truncate text-[12px] text-white/60">{cart.note}</p>
          </div>}
        </div>

        {/* The total, and the button a thumb actually presses. */}
        <div className={`border-t border-white/10 ${compact ? "p-3.5" : "p-5"}`}>
          <div className={`flex items-baseline justify-between ${compact ? "mb-2.5" : "mb-4"}`}>
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
              {compact ? "Total" : "Grand total"}
            </span>
            <span
              key={`${trade}-total`}
              className={`rings-up font-bold tabular-nums tracking-tight text-white ${
                compact ? "text-xl" : "text-3xl"
              }`}
              style={{ "--ring-delay": "260ms" } as React.CSSProperties}
            >
              Rs {rupees(compact ? lines.reduce((sum, l) => sum + l.price, 0) : total)}
            </span>
          </div>
          <div className={`bg-brand-500 text-center font-semibold text-white shadow-lg shadow-brand-500/30 ${
            compact ? "rounded-xl py-2.5 text-[13px]" : "rounded-2xl py-3.5 text-sm"
          }`}>
            Tender / Pay
          </div>
        </div>
      </div>
    </div>
  );
}
