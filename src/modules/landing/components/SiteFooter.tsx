import { Link } from "react-router";

import { Wordmark } from "../../../components/brand/Brand";
import { TRADE_CART } from "./tradeCarts";
import type { TradeCode } from "./tradeIcon";

const TRADES: TradeCode[] = [
  "food", "mart", "pharmacy", "retail",
  "services", "automotive", "petroleum", "finance",
];

/**
 * THE FOOTER — where somebody who scrolled the whole page ends up.
 *
 * Reaching the bottom means they read it and did not press anything, which is
 * a specific state: interested, not convinced. The three things that state
 * needs are a way to ask a person, a way back to the section they half
 * remember, and evidence there is a real company behind this — an address and
 * a phone number, not a form.
 *
 * The trade column is generated from the same record the till reads, so a
 * ninth trade appears here without anybody remembering to add it, and a
 * renamed one cannot be renamed in only one of the two places.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-gray-950 text-gray-400">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            {/* `onDark`, and it has to be. This footer is gray-950 in BOTH
                themes, and the mark's default colours follow the theme — so on
                a page in light mode it drew near-black letters on near-black
                ground and the brand simply vanished. Its own docblock warns
                about exactly this surface. A wrapper setting `text-white` was
                not enough: the letters carry their own colour class. */}
            <Wordmark size={30} tone="onDark" />
            <p className="mt-5 max-w-xs text-sm leading-relaxed">
              A complete business system for shops — the counter, the stock
              room, the khata and the books, in one place, and a till that keeps
              selling when the internet does not.
            </p>

            <dl className="mt-6 space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="sr-only">Email</dt>
                <dd>
                  <a href="mailto:hello@cartze.shop" className="transition hover:text-white">
                    hello@cartze.shop
                  </a>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="sr-only">Where we are</dt>
                <dd>Karachi, Pakistan</dd>
              </div>
            </dl>
          </div>

          <nav aria-label="Product">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">Product</h2>
            <ul className="mt-5 space-y-3 text-sm">
              <li><a href="#offline" className="transition hover:text-white">Selling offline</a></li>
              <li><a href="#inside" className="transition hover:text-white">What is inside</a></li>
              <li><a href="#day" className="transition hover:text-white">The owner&rsquo;s day</a></li>
              <li><a href="#pricing" className="transition hover:text-white">Pricing</a></li>
              <li><Link to="/demo" className="transition hover:text-white">Try the demo</Link></li>
            </ul>
          </nav>

          <nav aria-label="Trades">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">Trades</h2>
            <ul className="mt-5 space-y-3 text-sm">
              {TRADES.map((code) => (
                <li key={code}>
                  <a href="#trades" className="transition hover:text-white">{TRADE_CART[code].label}</a>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">Company</h2>
            <ul className="mt-5 space-y-3 text-sm">
              <li><a href="#talk" className="transition hover:text-white">Talk to us</a></li>
              <li><a href="#faq" className="transition hover:text-white">Common questions</a></li>
              <li><Link to="/shops" className="transition hover:text-white">Marketplace</Link></li>
              <li><Link to="/signin" className="transition hover:text-white">Sign in</Link></li>
            </ul>

            <a
              href="#talk"
              className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/5"
            >
              Ask for a walkthrough
            </a>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-7 sm:flex-row">
          <p className="text-sm">© {new Date().getFullYear()} CartZe. Built for the counter.</p>
          <p className="text-sm">
            <a href="#talk" className="transition hover:text-white">Talk to us</a>
          </p>
        </div>
      </div>
    </footer>
  );
}
