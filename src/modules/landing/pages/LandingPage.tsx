import { Link } from "react-router";

import { Wordmark } from "../../../components/brand/Brand";
import PageMeta from "../../../components/common/PageMeta";
import { TillMock } from "../components/TillMock";
import { TRADE_ICON, type TradeCode } from "../components/tradeIcon";
import { useSettlesIn } from "../components/useSettlesIn";

/**
 * WHAT cartze.shop ANSWERS.
 *
 * It used to answer with the customer marketplace — a list of somebody else's
 * shops — which is the wrong reply to the person who pays for this. A customer
 * arrives at a shop through that shop's own link; the shopkeeper arrives here,
 * deciding whether to trust their day's takings to it.
 *
 * So the page is written for one reader, and it leads with the thing no
 * competitor round here can say: the till keeps selling when the line drops.
 * In a country where the power and the internet both go, that is not a feature
 * on a list — it is the reason to switch.
 */

/** The trades, with the words a shopkeeper would use about themselves. */
const TRADES: Array<{ code: TradeCode; label: string; blurb: string }> = [
  { code: "food", label: "Restaurant & café", blurb: "Tables, KOTs, per-size recipes, delivery" },
  { code: "mart", label: "Mart & grocery", blurb: "Weighing, packs, barcodes, khata" },
  { code: "pharmacy", label: "Pharmacy", blurb: "Batches, expiry, prescriptions, FEFO" },
  { code: "retail", label: "Retail store", blurb: "Sizes, colours, IMEI, warranty" },
  { code: "services", label: "Salon & services", blurb: "An hour is stock too" },
  { code: "automotive", label: "Auto & tyre", blurb: "Bay board, vehicle history, trade-ins" },
  { code: "petroleum", label: "Petrol pump", blurb: "Meter rolls, dips, shift handover" },
  { code: "finance", label: "Finance", blurb: "Every rupee, in and out" },
];

const PLANS: Array<{
  name: string; price: string; line: string; points: string[]; featured?: boolean;
}> = [
  {
    name: "Basic",
    price: "2,500",
    line: "One counter, one shop.",
    points: ["One branch", "Up to 2 tills", "Full catalogue & stock", "Khata and daily close", "Help centre in the app"],
  },
  {
    name: "Premium",
    price: "6,000",
    line: "The shop that has outgrown one till.",
    points: ["Up to 3 branches", "More tills per branch", "Offline selling", "Staff jobs & permissions", "Online orders & delivery"],
    featured: true,
  },
  {
    name: "Enterprise",
    price: "15,000",
    line: "A chain, with a head office.",
    points: ["Branches as you need them", "Cross-branch stock & transfers", "HQ reporting", "Priority support", "Anything above, without a ceiling"],
  },
];

/** Said once, so the two CTAs cannot drift apart. */
function TryDemo({ big = false }: { big?: boolean }) {
  return (
    <Link
      to="/demo"
      className={`calls-you-over relative isolate inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-brand-500 font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-600 ${
        big ? "px-7 py-4 text-base" : "px-5 py-2.5 text-sm"
      }`}
    >
      {/* The shine — a GRADIENT, not a slab.
          A solid band was the first version, and a still of the page caught it
          parked over the button looking like a rendering fault. A sheen has no
          edges, so there is no frame of the animation that reads as a defect.

          `pointer-events-none` because an overlay that eats the press on a call
          to action is a defect this codebase has already met on the till. */}
      <span
        aria-hidden="true"
        className="shine-crosses pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/30 to-transparent"
      />
      Try the demo
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
        <path d="M4 10h11m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

export default function LandingPage() {
  useSettlesIn();

  return (
    <div className="min-h-dvh bg-white text-gray-900 dark:bg-gray-950 dark:text-white/90">
      <PageMeta
        title="CartZe — the till that keeps selling"
        description="A complete business system for Pakistani shops: point of sale, stock, khata, staff and reporting — built for eight trades, and it keeps selling when the internet does not."
      />

      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-gray-200/70 bg-white/80 backdrop-blur-md dark:border-white/10 dark:bg-gray-950/80">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
          {/* THE REAL MARK, not the word typed again.
              `Brand.tsx` exists because the wordmark used to be three SVG
              files that were forever one edit apart — an SVG in an <img> is
              its own document and inherits neither the font nor the theme.
              Retyping "CartZe" here would have made a fourth copy on the one
              page the product is sold from. */}
          <Link to="/" aria-label="CartZe home">
            <Wordmark size={30} />
          </Link>

          <div className="hidden items-center gap-7 md:flex">
            <a href="#product" className="text-sm font-medium text-gray-600 transition hover:text-brand-500 dark:text-gray-300">Product</a>
            <a href="#trades" className="text-sm font-medium text-gray-600 transition hover:text-brand-500 dark:text-gray-300">Trades</a>
            <a href="#pricing" className="text-sm font-medium text-gray-600 transition hover:text-brand-500 dark:text-gray-300">Pricing</a>
            <Link to="/shops" className="text-sm font-medium text-gray-600 transition hover:text-brand-500 dark:text-gray-300">Marketplace</Link>
          </div>

          <div className="flex items-center gap-2.5">
            <Link to="/signin" className="rounded-lg px-3.5 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5">
              Sign in
            </Link>
            <TryDemo />
          </div>
        </nav>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* A wash behind the fold. Decorative only. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-40 h-[36rem] bg-[radial-gradient(50%_50%_at_50%_50%,rgba(70,95,255,0.12),transparent_70%)]" />

        <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-16 lg:grid-cols-2 lg:py-24">
          <div className="settles">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3.5 py-1.5 text-xs font-semibold text-brand-700 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              Built for shops in Pakistan
            </span>

            <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-tight text-balance sm:text-5xl lg:text-6xl">
              The till that keeps
              <span className="text-brand-500"> selling</span> when
              the internet stops.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-gray-600 dark:text-gray-300">
              Point of sale, stock, khata, staff and reporting in one place — and
              a counter that carries on through a power cut, then sends every
              sale the moment the line comes back.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3.5">
              <TryDemo big />
              <a href="#pricing" className="rounded-xl border border-gray-300 px-6 py-4 text-base font-semibold text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/5">
                See pricing
              </a>
            </div>

            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              No card, no phone call. The demo opens a shop of your own.
            </p>
          </div>

          <div className="settles" style={{ "--settle-delay": "160ms" } as React.CSSProperties}>
            <TillMock />
          </div>
        </div>
      </section>

      {/* ── The offline argument, said once and properly ─────────────── */}
      <section id="product" className="border-y border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <div className="settles mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              A queue does not wait for the internet
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-gray-600 dark:text-gray-300">
              Most systems stop taking money the moment the line drops. This one
              keeps a copy of your catalogue and your prices on the counter
              itself, so the sale goes through, the receipt prints, and the queue
              moves.
            </p>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {[
              { t: "Sells with no line", d: "The whole catalogue and every price live on the device. A sale rung during an outage is a real sale, with its own slip number the customer can be found by." },
              { t: "Nothing is lost", d: "Unsent sales sit in a queue you can see and count. When the line returns they go, in order, and the till says how many are left." },
              { t: "And it tells you", d: "A sale the server refuses comes back with the reason, on the till, in words — never a silent failure with money already in the drawer." },
            ].map((card, i) => (
              <div
                key={card.t}
                className="settles rounded-2xl border border-gray-200 bg-white p-6 dark:border-white/10 dark:bg-gray-900"
                style={{ "--settle-delay": `${i * 110}ms` } as React.CSSProperties}
              >
                <h3 className="text-base font-semibold">{card.t}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{card.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trades ──────────────────────────────────────────────────── */}
      <section id="trades" className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
        <div className="settles mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Eight trades, and it knows the difference
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-gray-600 dark:text-gray-300">
            A pharmacy needs batches and expiry dates. A restaurant needs a
            kitchen that hears the order. A tyre shop sells the oldest stock
            first. None of that is a setting you have to find.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRADES.map((trade, i) => {
            const Icon = TRADE_ICON[trade.code];

            return (
              <div
                key={trade.code}
                className="settles group rounded-2xl border border-gray-200 bg-white p-5 transition hover:-translate-y-1 hover:border-brand-300 hover:shadow-lg dark:border-white/10 dark:bg-gray-900 dark:hover:border-brand-500/40"
                style={{ "--settle-delay": `${(i % 4) * 90}ms` } as React.CSSProperties}
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-500 group-hover:text-white dark:bg-brand-500/10 dark:text-brand-300">
                  <Icon />
                </span>
                <h3 className="mt-4 font-semibold">{trade.label}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{trade.blurb}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────── */}
      <section id="pricing" className="border-t border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
          <div className="settles mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              Priced in rupees, per month
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-gray-600 dark:text-gray-300">
              No setup fee and no per-transaction cut. What you sell is yours.
            </p>
          </div>

          <div className="mt-12 grid items-start gap-6 lg:grid-cols-3">
            {PLANS.map((plan, i) => (
              <div
                key={plan.name}
                className={`settles relative rounded-2xl border p-7 ${
                  plan.featured
                    ? "border-brand-500 bg-white shadow-xl shadow-brand-500/10 lg:-mt-4 lg:pb-10 dark:bg-gray-900"
                    : "border-gray-200 bg-white dark:border-white/10 dark:bg-gray-900"
                }`}
                style={{ "--settle-delay": `${i * 110}ms` } as React.CSSProperties}
              >
                {plan.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-500 px-3.5 py-1 text-xs font-semibold text-white">
                    Most shops
                  </span>
                )}

                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{plan.line}</p>

                <p className="mt-6 flex items-baseline gap-1.5">
                  <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">Rs</span>
                  <span className="text-4xl font-bold tabular-nums tracking-tight">{plan.price}</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">/month</span>
                </p>

                <ul className="mt-7 space-y-3">
                  {plan.points.map((point) => (
                    <li key={point} className="flex gap-2.5 text-sm text-gray-600 dark:text-gray-300">
                      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 h-4.5 w-4.5 shrink-0 text-brand-500">
                        <path d="m4.5 10.5 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {point}
                    </li>
                  ))}
                </ul>

                <Link
                  to="/demo"
                  className={`mt-8 block rounded-xl py-3 text-center text-sm font-semibold transition ${
                    plan.featured
                      ? "bg-brand-500 text-white hover:bg-brand-600"
                      : "border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/5"
                  }`}
                >
                  Try it first
                </Link>
              </div>
            ))}
          </div>

          <p className="settles mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Running something bigger, or something odd?{" "}
            <a href="mailto:hello@cartze.shop" className="font-medium text-brand-500 hover:text-brand-600">Tell us about it</a>{" "}
            — plans are set per shop.
          </p>
        </div>
      </section>

      {/* ── Close ───────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-20 text-center lg:py-28">
        <div className="settles">
          <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Open a shop of your own and ring a sale
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-gray-600 dark:text-gray-300">
            The demo builds a real shop for your trade, stocked and ready. It is
            yours alone, and it clears itself away after a day.
          </p>
          <div className="mt-9 flex justify-center">
            <TryDemo big />
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-200 dark:border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
          <Wordmark size={28} />
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-gray-500 dark:text-gray-400">
            <Link to="/shops" className="transition hover:text-brand-500">Marketplace</Link>
            <a href="#pricing" className="transition hover:text-brand-500">Pricing</a>
            <Link to="/signin" className="transition hover:text-brand-500">Sign in</Link>
          </div>
          <span className="text-sm text-gray-400 dark:text-gray-500">© {new Date().getFullYear()} CartZe</span>
        </div>
      </footer>
    </div>
  );
}
