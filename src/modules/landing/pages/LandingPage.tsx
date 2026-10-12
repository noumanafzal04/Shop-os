import { Link } from "react-router";

import PageMeta from "../../../components/common/PageMeta";
import { ProductShot } from "../components/ProductShots";
import { EnquiryForm } from "../components/EnquiryForm";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { TradeSwitcher } from "../components/TradeSwitcher";
import { PLANS, pointsOf, priceOf } from "../plans";
import { TryDemo } from "../components/TryDemo";
import { useSettlesIn } from "../components/useSettlesIn";

/**
 * WHAT cartze.shop ANSWERS.
 *
 * It used to answer with the customer marketplace — a list of somebody else's
 * shops — which is the wrong reply to the person who pays for this. A customer
 * arrives at a shop through that shop's own link; the shopkeeper arrives here,
 * deciding whether to trust their day's takings to it.
 *
 * ── Why the top of the page is dark ────────────────────────────────────
 *
 * The argument this product wins on is a shop whose power and internet have
 * gone and whose counter has not. So the fold is a dark room with one lit
 * thing in it: the till, still ringing. That is the pitch drawn rather than
 * claimed, and it is the only reason for the colour — a dark hero for the look
 * of it would be a fashion, and this one is an argument.
 *
 * ── Why nothing on this page is a number about customers ───────────────
 *
 * No "10,000 shops", no logos of businesses that have not agreed, no invented
 * testimonials. Everything asserted here is either true of the software today
 * or is a price. The demo is the proof, and it is one tap away — which is a
 * stronger claim than any figure would be, because it can be checked.
 */

/** What is actually in the box. Twelve, because a list of four looks like a
 *  prototype and a shopkeeper is comparing this against a ledger. */
const INSIDE: Array<{ title: string; body: string; d: string }> = [
  {
    title: "Point of sale",
    body: "Keyboard-driven, touch-friendly, and it carries on with the line down. Split tenders, held bills, returns and exchanges.",
    d: "M3.5 5.5h17v10h-17zM8 19.5h8M12 15.5v4",
  },
  {
    title: "Stock, per branch",
    body: "Each branch counts its own shelf. Look up another branch's stock, move it across, and see what it cost you.",
    d: "M4 8.5 12 4l8 4.5-8 4.5-8-4.5ZM4 8.5v7l8 4.5 8-4.5v-7",
  },
  {
    title: "Khata that adds up",
    body: "Credit with a limit, a statement the customer can read, and a ledger that never records the same rupee twice.",
    d: "M6 3.5h12v17H6zM9.5 8h5M9.5 12h5M9.5 16h3",
  },
  {
    title: "Buying and suppliers",
    body: "Purchase orders, receiving, and a cost that reblends itself on every delivery — so margin is the truth, not a guess.",
    d: "M3 7.5h11v8H3zM14 10.5h3.4l2.6 3v2h-6zM7 19a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 7 19ZM17 19a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 17 19Z",
  },
  {
    title: "Staff, by permission",
    body: "No job titles to argue with. You choose what a person may do, branch by branch, and the till records who sold it.",
    d: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.5 19.5a5.5 5.5 0 0 1 11 0M16 5.7a3 3 0 0 1 0 6M17.2 14.4a5.5 5.5 0 0 1 3.3 5.1",
  },
  {
    title: "Money out, money in",
    body: "Expenses with the receipt attached, budgets to answer to, and recurring bills that fall due and post themselves.",
    d: "M4 7.5h13a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4zM4 7.5v-1a2 2 0 0 1 2-2h9M16.2 13h.01",
  },
  {
    title: "The day, closed properly",
    body: "Open a till, count it, close it. Shift handover, banking, and a day that can only be closed once.",
    d: "M4 19.5h16M7 16.5V10M12 16.5V5.5M17 16.5v-4",
  },
  {
    title: "Customers and loyalty",
    body: "Groups with their own prices, points earned and redeemed, and the history of what somebody usually buys.",
    d: "M12 3.8l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.5l5.4-.8z",
  },
  {
    title: "Orders from outside",
    body: "Your own storefront and delivery. An order goes to the nearest branch that holds the whole basket, not to a queue.",
    d: "M12 20.2a8.2 8.2 0 1 0 0-16.4 8.2 8.2 0 0 0 0 16.4ZM3.8 12h16.4M12 3.8a13 13 0 0 1 0 16.4 13 13 0 0 1 0-16.4",
  },
  {
    title: "The hardware you own",
    body: "Receipt printers, cash drawers and scanners over the connection you already have. Two receipt widths, printed properly.",
    d: "M7 4.5h10v4H7zM4.5 8.5h15v6h-15zM8 13.5h8v6H8z",
  },
  {
    title: "Batches and expiry",
    body: "Every lot carries its date, the nearest one leaves first, and you are told once per lot — not every morning.",
    d: "M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4.5v4M15.5 4.5v4M11 14.5h2.5",
  },
  {
    title: "Reports you can act on",
    body: "Profit that counts income as well as sales, a July-to-June tax year beside the calendar one, and what to reorder.",
    d: "M6 3.5h8l4 4v13H6zM14 3.5v4h4M9 12.5h6M9 16h4",
  },
];

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: "Choose your trade",
    body: "One tap. A restaurant, a pharmacy, a pump — whichever you are. Nothing to fill in and no card.",
  },
  {
    title: "A shop arrives, already stocked",
    body: "Real products at real prices, staff, a till and a day open. You can ring a sale within a minute of landing.",
  },
  {
    title: "Keep it, if it suits you",
    body: "Press keep and everything you set up stays exactly as it is. We turn it into a real shop — nothing is rebuilt.",
  },
];

/** Answers, including to the questions that are awkward for us. */
const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Does it genuinely keep selling with no internet?",
    a: "Yes. Your products, the prices and the day's settings live on the counter itself, so a sale rings, the receipt prints and the drawer opens with nothing behind it. Each of those sales gets its own slip number the customer can be found by later. When the line comes back they go up in order, and the till counts them down as they go.",
  },
  {
    q: "What happens to an offline sale the server later refuses?",
    a: "It comes back to the till with the reason, in words, and it stays in the queue until somebody decides what to do about it. It is never dropped quietly — money was taken at the counter, so a silent failure is the one outcome that is not allowed.",
  },
  {
    q: "Do I have to buy new hardware?",
    a: "No. It runs in the browser on the computer, tablet or phone you already have. If you own a receipt printer, a cash drawer or a barcode scanner, it will talk to them over the connection they already use, at either receipt width.",
  },
  {
    q: "Do you take a cut of my sales?",
    a: "No. A monthly price and nothing per transaction. What you sell is yours.",
  },
  {
    q: "Do you process card payments for me?",
    a: "No, and we would rather say so plainly. You take payment however you already do — cash, card machine, bank transfer, credit — and record it as taken. Nothing about your money passes through us.",
  },
  {
    q: "Can I stop a cashier giving discounts away?",
    a: "Yes. You set a ceiling, and it holds at the till, on a dine-in bill and at the moment of settling — the same rule in all three places, so there is no door round the back.",
  },
  {
    q: "I have more than one branch. Does it understand that?",
    a: "Each branch counts its own stock, sells at its own counter and closes its own day. You can look up another branch's shelf, transfer stock across, and read the whole business from one place.",
  },
  {
    q: "What exactly does the demo give me?",
    a: "A working shop of your own for your trade, already stocked with products at real prices, with staff and an open till. It is yours alone, nobody else can see it, and it clears itself away after a day. If you want to keep it, press keep — what you built is converted, not rebuilt.",
  },
];

export default function LandingPage() {
  useSettlesIn();

  return (
    <div className="min-h-dvh bg-white text-gray-900 dark:bg-gray-950 dark:text-white/90">
      <PageMeta
        title="The till that keeps selling"
        description="A complete business system for shops: point of sale, stock, khata, staff and reporting — built for nine trades, and it keeps selling when the internet does not."
      />

      <SiteHeader overDark />

      {/* ══ HERO — a dark shop with one lit counter ══════════════════ */}
      {/* IT STARTS BEHIND THE HEADER, by exactly the height the header just
          measured of itself. So the band's gradient and grid run up behind the
          links and there is no line across the top of the page.

          The number is a variable and not a literal because both literals
          tried here were wrong: `62px` was the header before the nav grew a
          pill, and wrapping the two in one dark box instead broke `sticky`.
          See `SiteHeader`. */}
      <section
        className="landing-night relative overflow-hidden text-white"
        style={{
          marginTop: "calc(var(--landing-header, 0px) * -1)",
          paddingTop: "var(--landing-header, 0px)",
        }}
      >
        {/* The room. A light from the top, a faint grid to give the dark some
            texture, and a second light where the screen stands. Decorative.

            Both lights are the brand's (see `.landing-night`), and both are
            on the centre line: everything in this band is centred, and a
            glow in one corner with another in the opposite corner made the
            band lean. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="landing-night-light absolute inset-0 [--light-size:75%_48%] [--light-strength:36%] [--light-ends:70%]" />
          <div className="landing-night-light absolute inset-0 [--light-size:60%_34%] [--light-at:50%_64%] [--light-strength:16%] [--light-ends:72%]" />
          <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:56px_56px]" />
        </div>

        <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-8 sm:px-8 lg:pb-20 lg:pt-10">
          {/* CENTRED, because what follows it is full-bleed. A left-aligned
              column above a picture that runs the whole width leaves the
              headline hanging off one corner of its own hero. */}
          <div className="settles mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/80 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
              One system for every kind of shop
            </span>

            <h1 className="mt-5 text-[2.6rem] font-bold leading-[1.02] tracking-[-0.03em] text-balance sm:text-[3.4rem] lg:text-[3.75rem]">
              The lights go.
              <br />
              <span className="bg-gradient-to-r from-brand-300 via-brand-400 to-brand-300 bg-clip-text text-transparent">
                The counter doesn&rsquo;t.
              </span>
            </h1>

            {/* Two lines on a laptop, not three: the line it saves is a line
                more of the product on the first screen. */}
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-white/65 sm:text-xl lg:max-w-4xl">
              Point of sale, stock, khata, staff and reporting in one place —
              and a till that carries on through a power cut, then sends every
              sale the moment the line comes back.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
              <TryDemo big />
              <a
                href="#talk"
                className="rounded-xl border border-white/20 px-6 py-4 text-base font-semibold text-white transition hover:border-white/40 hover:bg-white/5"
              >
                Ask for a walkthrough
              </a>
            </div>

            <p className="mt-3 text-sm text-white/45">
              No card, no phone call. The demo opens a real shop of your own.
            </p>
          </div>

          {/* THE PRODUCT, FULL WIDTH — and the real one: the dashboard, and
              only the dashboard. The till has a section of its own below.
              See ProductShots.
              It is under the headline rather than beside it because a console
              with a rail down its side needs the whole column to be readable —
              squeezed into a half-width slot the labels become smudges, and a
              picture nobody can read says only "some software". */}
          {/* NOT `settles`. The scroll-reveal hides a block until enough of it
              has crossed into view — a share of its own height. This one is
              eight hundred pixels tall and starts near the bottom of a laptop
              screen, so on a 1366 × 768 display it never crossed the line: the
              page opened on a headline, two buttons, and an empty dark band
              where the product should have been. What is above the fold is
              simply there. */}
          <div className="relative mt-8">
            <ProductShot shot="dashboard" first />
          </div>

          {/* The four things that are true, said as facts rather than as
              invented customer figures. Below the picture, because they are
              what you are left holding after looking at it. */}
          {/* Directly under the window's fade — no rule above them. The
              picture ends in these four facts rather than in a line and a gap. */}
          <dl className="settles relative mt-6 grid grid-cols-2 gap-x-8 gap-y-8 text-center sm:mt-8 sm:grid-cols-4">
            {[
              ["9", "trades, each with its own rules"],
              ["0", "sales lost when the line drops"],
              ["12", "parts of a shop, not twelve subscriptions"],
              ["24h", "demo shop, yours alone"],
            ].map(([big, small]) => (
              <div key={small}>
                <dt className="text-3xl font-bold tabular-nums tracking-tight text-white">{big}</dt>
                <dd className="mt-1.5 text-[13px] leading-snug text-white/45">{small}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ══ THE OFFLINE ARGUMENT ═════════════════════════════════════ */}
      <section id="offline" className="border-b border-gray-200 bg-white dark:border-white/10 dark:bg-gray-950">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          {/* CENTRED, like every heading that stands over a full-width row.
              This one and "What is inside" hung off the left edge above three
              equal columns, between sections whose headings were centred —
              the page changed its mind about where a heading goes four times
              on the way down. A heading beside a picture keeps the left. */}
          <div className="settles mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
              Why it is different
            </p>
            <h2 className="mt-5 text-4xl font-bold leading-[1.08] tracking-[-0.02em] text-balance sm:text-5xl">
              A queue does not wait for the internet
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-gray-600 dark:text-gray-300">
              Most systems stop taking money the moment the line drops, and
              lines drop. Everything below is what happens in
              that hour, in order.
            </p>
          </div>

          {/* Three moments, numbered because they really are a sequence: the
              line goes, the shop carries on, the line comes back. Numbering
              anything that is not a sequence is decoration. */}
          <ol className="mt-16 grid gap-6 lg:grid-cols-3">
            {[
              {
                t: "The line drops",
                d: "Nothing on the counter changes. Every product and every price is already on the device, so the next customer is served exactly as the last one was.",
              },
              {
                t: "The queue keeps moving",
                d: "Sales ring, receipts print and the drawer opens. Each one gets its own slip number, so the customer can be found and refunded later by the slip they were handed.",
              },
              {
                t: "The line comes back",
                d: "The queue sends itself, in order, and the till counts it down in front of you. Anything the server refuses comes back with the reason — never silently.",
              },
            ].map((step, i) => (
              <li
                key={step.t}
                className="settles relative rounded-3xl border border-gray-200 bg-gray-50 p-8 dark:border-white/10 dark:bg-white/[0.03]"
                style={{ "--settle-delay": `${i * 110}ms` } as React.CSSProperties}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-sm font-bold tabular-nums text-white">
                  {i + 1}
                </span>
                <h3 className="mt-6 text-lg font-semibold">{step.t}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-gray-600 dark:text-gray-400">{step.d}</p>
              </li>
            ))}
          </ol>

          <p className="settles mx-auto mt-10 max-w-3xl text-center text-[15px] leading-relaxed text-gray-500 dark:text-gray-400">
            One honest caveat: for the till to keep working with no line at all,
            it has to be installed on the device first, and a browser will only
            install it over a secure address. Yours, on your own domain — we set
            it up with you.
          </p>
        </div>
      </section>

      {/* ══ THE COUNTER — the till itself ════════════════════════════ */}
      {/* Dark, because the till is: it is drawn for a counter under strip
          lights, and its picture fades out at the bottom into whatever is
          behind it. On white that fade is a grey smear. `overflow-hidden`
          for the phone, which stands a little outside the column. */}
      <section id="counter" className="landing-night relative overflow-hidden border-b border-white/10 text-white">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="landing-night-light absolute inset-0 [--light-size:55%_45%] [--light-strength:28%] [--light-ends:70%]" />
          <div className="absolute inset-0 opacity-[0.05] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:56px_56px]" />
        </div>

        <div className="relative mx-auto max-w-7xl px-5 pb-10 pt-20 sm:px-8 lg:pt-28">
          <div className="settles mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">
              At the counter
            </p>
            <h2 className="mt-5 text-4xl font-bold leading-[1.08] tracking-[-0.02em] text-balance sm:text-5xl">
              The same till, on a counter or in a hand
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-white/65">
              Tap a dish or scan a barcode, see the tax worked out line by
              line, take the money. On the screen by the door it looks like
              this; on a phone on the shop floor it is the same sale, the same
              buttons and the same total.
            </p>
          </div>

          <div className="relative mt-12 lg:mt-14">
            <ProductShot shot="pos" />
          </div>

          {/* Three things a cashier's hands find out in the first minute.
              Each is on the screen above. */}
          <ul className="settles relative mx-auto mt-8 grid max-w-5xl gap-x-10 gap-y-6 text-center sm:grid-cols-3">
            {[
              ["A key for every move", "Search, hold, drafts and pay are one key each — for the cashier who never touches the mouse."],
              ["Hold one, serve the next", "Park a sale while somebody fetches their wallet, ring the next customer, and bring the first one back."],
              ["The total is the total", "Discount, tax and charges are worked out as each line goes in, and the figure by the button is what is taken."],
            ].map(([title, body]) => (
              <li key={title}>
                <p className="text-base font-semibold text-white">{title}</p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-white/55">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ══ TRADES — the claim, then the evidence ════════════════════ */}
      {/* `overflow-hidden` because the till throws a soft light 40px past its
          own edges, and on a phone that light is what made the whole page
          scroll sideways by 20px. A decorative glow must never widen the
          document — it is clipped at the band it belongs to. */}
      <section id="trades" className="overflow-hidden border-b border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="settles mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
              Nine trades
            </p>
            <h2 className="mt-5 text-4xl font-bold leading-[1.08] tracking-[-0.02em] text-balance sm:text-5xl">
              Every system says it knows your trade
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-gray-600 dark:text-gray-300">
              So do not take ours on trust. Pick one and watch the till change —
              the items, the units and the one line only that trade needs.
            </p>
          </div>

          <div className="settles mt-14">
            <TradeSwitcher />
          </div>
        </div>
      </section>

      {/* ══ THE OWNER'S DAY ══════════════════════════════════════════ */}
      <section id="day" className="border-b border-gray-200 bg-white dark:border-white/10 dark:bg-gray-950">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:gap-20">
            <div className="settles">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
                For whoever owns it
              </p>
              <h2 className="mt-5 text-4xl font-bold leading-[1.08] tracking-[-0.02em] text-balance sm:text-[2.75rem]">
                At nine at night, what did the shop do?
              </h2>
              <p className="mt-6 text-lg leading-relaxed text-gray-600 dark:text-gray-300">
                The till is for the person at the counter. This is for you: what
                came in, what is owed, what is running out, and what sold. On a
                phone, from anywhere, without ringing anybody.
              </p>

              <ul className="mt-8 space-y-4">
                {[
                  "Takings by hour, so you know which hour needs a second counter",
                  "Khata totals with the customers who are over their limit named",
                  "What is running out — and whoever can reorder it has already been told",
                  "Every branch on its own, or the whole business in one figure",
                ].map((point) => (
                  <li key={point} className="flex gap-3.5 text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">
                    <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3 w-3">
                        <path d="m4.5 10.5 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            {/* THE SAME CONSOLE, IN A HAND.
                The hero already showed this on a desk, so showing it again on
                a desk would be the same picture twice. The section's own
                sentence is "on a phone, from anywhere" — so it is a phone,
                and it is the real dashboard as a phone draws it. */}
            <div
              className="settles mx-auto w-full max-w-[21rem]"
              style={{ "--settle-delay": "140ms" } as React.CSSProperties}
            >
              <div className="rounded-[2.5rem] bg-gray-900 p-2.5 shadow-2xl shadow-gray-900/25 ring-1 ring-gray-900/10 dark:bg-gray-800 dark:shadow-black/40 dark:ring-white/10">
                {/* AN IPHONE 17'S SCREEN, to the point: 402 × 874 CSS pixels
                    (2622 × 1206 at 3×). Pinned as a ratio rather than a height,
                    so the frame stays that shape at every width — a phone drawn
                    at the wrong proportions is the detail that makes a mock
                    look like a mock. */}
                <div className="relative aspect-[402/874] overflow-hidden rounded-[2rem] bg-white dark:bg-gray-950">
                  <img
                    src="/landing/dashboard-phone.webp"
                    width={804}
                    height={1748}
                    loading="lazy"
                    decoding="async"
                    alt="The same dashboard on a phone: what needs the owner first, then today's sales, expenses and profit."
                    className="absolute inset-0 size-full object-cover object-top"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ WHAT IS INSIDE ═══════════════════════════════════════════ */}
      <section id="inside" className="border-b border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="settles mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
              What is inside
            </p>
            <h2 className="mt-5 text-4xl font-bold leading-[1.08] tracking-[-0.02em] text-balance sm:text-5xl">
              One system, not five subscriptions
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-gray-600 dark:text-gray-300">
              The counter, the stock room, the khata register and the books are
              the same shop. Here they are the same software, so a sale moves
              stock, settles credit and lands in the accounts by itself.
            </p>
          </div>

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {INSIDE.map((item, i) => (
              <div
                key={item.title}
                className="settles group rounded-3xl border border-gray-200 bg-white p-7 transition duration-300 hover:-translate-y-1 hover:border-brand-300 hover:shadow-xl hover:shadow-brand-500/5 dark:border-white/10 dark:bg-gray-900 dark:hover:border-brand-500/40"
                style={{ "--settle-delay": `${(i % 3) * 90}ms` } as React.CSSProperties}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 transition duration-300 group-hover:bg-brand-500 group-hover:text-white dark:bg-brand-500/10 dark:text-brand-300">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6">
                    <path d={item.d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-gray-600 dark:text-gray-400">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ HOW IT STARTS ════════════════════════════════════════════ */}
      <section className="border-b border-gray-200 bg-white dark:border-white/10 dark:bg-gray-950">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="settles mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
              How it starts
            </p>
            <h2 className="mt-5 text-4xl font-bold leading-[1.08] tracking-[-0.02em] text-balance sm:text-5xl">
              You will have rung a sale in a minute
            </h2>
          </div>

          <ol className="mt-16 grid gap-8 lg:grid-cols-3">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="settles relative text-center"
                style={{ "--settle-delay": `${i * 120}ms` } as React.CSSProperties}
              >
                {/* The rule between steps — it is a sequence, so it is drawn
                    as one. Hidden on a phone, where they stack instead.
                    From one number to the next, the same gap either side:
                    it ran from each number to the column's right edge and
                    faded out, under a heading that was centred. */}
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute left-[calc(50%+2.25rem)] top-6 hidden h-px w-[calc(100%-2.5rem)] bg-brand-200 lg:block dark:bg-white/15"
                  />
                )}
                <span className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-brand-500 bg-white text-lg font-bold tabular-nums text-brand-600 dark:bg-gray-950 dark:text-brand-300">
                  {i + 1}
                </span>
                <h3 className="mt-6 text-xl font-semibold">{step.title}</h3>
                <p className="mx-auto mt-3 max-w-xs text-[15px] leading-relaxed text-gray-600 dark:text-gray-400">{step.body}</p>
              </li>
            ))}
          </ol>

          <div className="settles mt-14 flex justify-center">
            <TryDemo big />
          </div>
        </div>
      </section>

      {/* ══ PRICING ══════════════════════════════════════════════════ */}
      <section id="pricing" className="border-b border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="settles mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
              Pricing
            </p>
            <h2 className="mt-5 text-4xl font-bold leading-[1.08] tracking-[-0.02em] text-balance sm:text-5xl">
              One price, per month
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-gray-600 dark:text-gray-300">
              No setup fee and nothing per transaction. What you sell is yours.
            </p>
          </div>

          {/* FOUR CARDS, THE SAME HEIGHT, THE SAME SEVEN LINES — so a figure
              can be read straight across the row. The recommended one is
              marked by its border and its button, not by standing taller
              than its neighbours: three cards with the middle one raised was
              a shape; four with the second raised is a mistake. See
              `plans.ts` for where every figure comes from. */}
          <div className="mt-14 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {PLANS.map((plan, i) => (
              <div
                key={plan.code}
                className={`settles relative flex flex-col rounded-3xl border p-7 ${
                  plan.featured
                    ? "border-brand-500 bg-white shadow-2xl shadow-brand-500/10 ring-1 ring-brand-500 dark:bg-gray-900"
                    : "border-gray-200 bg-white dark:border-white/10 dark:bg-gray-900"
                }`}
                style={{ "--settle-delay": `${i * 90}ms` } as React.CSSProperties}
              >
                {plan.featured && (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white">
                    Most shops
                  </span>
                )}

                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{plan.line}</p>

                <p className="mt-6 flex items-baseline gap-1.5">
                  <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">Rs</span>
                  <span className="text-[2.6rem] font-bold leading-none tabular-nums tracking-[-0.03em]">{priceOf(plan)}</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">/month</span>
                </p>

                <ul className="mt-7 space-y-3 border-t border-gray-100 pb-8 pt-6 dark:border-white/10">
                  {pointsOf(plan).map((point) => (
                    <li
                      key={point.text}
                      className={`flex gap-3 text-[14.5px] leading-snug ${
                        point.off ? "text-gray-400 dark:text-gray-500" : "text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {point.off ? (
                        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600">
                          <path d="M5.5 10h9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500">
                          <path d="m4.5 10.5 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      <span>
                        {point.text}
                        {point.off && <span className="sr-only"> — not in this plan</span>}
                      </span>
                    </li>
                  ))}
                </ul>

                <Link
                  to="/demo"
                  className={`mt-auto block rounded-xl py-3.5 text-center text-sm font-semibold transition ${
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

          {/* WHAT EVERY PLAN COMES WITH. A plan sells room — branches, tills,
              bills — and never a part of the product: the parts are switched
              on by the shop's trade. They were scattered across three cards
              as if Basic lacked them ("Online orders & delivery" stood on the
              middle one). Said once, under all four, in the names the
              section above gave them. */}
          <div className="settles mt-6 rounded-3xl border border-gray-200 bg-white p-7 sm:p-9 dark:border-white/10 dark:bg-gray-900">
            <div className="mx-auto max-w-2xl text-center">
              <h3 className="text-lg font-semibold">On every plan</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                A plan sells room, never a feature. Every part your trade needs is
                on Basic too — and so are updates, the help centre and your own data, to take away whenever you like.
              </p>
            </div>
            <ul className="mt-7 grid grid-cols-2 gap-x-6 gap-y-3.5 sm:grid-cols-3 xl:grid-cols-4">
              {INSIDE.map((item) => (
                <li key={item.title} className="flex items-center gap-2.5 text-[14.5px] font-medium text-gray-700 dark:text-gray-300">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3 w-3">
                      <path d="m4.5 10.5 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  {item.title}
                </li>
              ))}
            </ul>
          </div>

          <p className="settles mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Running something bigger, or something odd?{" "}
            <a href="#talk" className="font-semibold text-brand-500 hover:text-brand-600">Tell us about it</a>{" "}
            — plans are set per shop.
          </p>
        </div>
      </section>

      {/* ══ QUESTIONS ════════════════════════════════════════════════ */}
      <section id="faq" className="border-b border-gray-200 bg-white dark:border-white/10 dark:bg-gray-950">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] lg:gap-20">
            <div className="settles">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
                Common questions
              </p>
              <h2 className="mt-5 text-4xl font-bold leading-[1.08] tracking-[-0.02em] text-balance">
                Including the awkward ones
              </h2>
              <p className="mt-6 text-[15px] leading-relaxed text-gray-600 dark:text-gray-400">
                If yours is not here, ask it below and a person will answer it.
              </p>
            </div>

            {/* <details> rather than a JavaScript accordion: it opens with no
                script, it is keyboard-operable and findable by the browser's
                own page search, and a landing page is precisely where somebody
                is searching for one word. */}
            <div className="settles divide-y divide-gray-200 border-y border-gray-200 dark:divide-white/10 dark:border-white/10">
              {FAQ.map((item) => (
                <details key={item.q} className="group py-6">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-left text-[17px] font-semibold text-gray-900 marker:content-none dark:text-white">
                    {item.q}
                    <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition group-open:rotate-45 group-open:bg-brand-500 group-open:text-white dark:bg-white/10 dark:text-gray-400">
                      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
                        <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </span>
                  </summary>
                  <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-gray-600 dark:text-gray-400">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ TALK TO US ═══════════════════════════════════════════════ */}
      <section id="talk" className="border-b border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
            <div className="settles">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
                Talk to us
              </p>
              <h2 className="mt-5 text-4xl font-bold leading-[1.08] tracking-[-0.02em] text-balance">
                Would you rather somebody showed you?
              </h2>
              <p className="mt-6 text-lg leading-relaxed text-gray-600 dark:text-gray-300">
                The demo is there whenever you want it, and it needs nothing
                from you. But if you would rather be walked through it, or you
                have one question standing in the way, say so here.
              </p>

              <dl className="mt-10 space-y-6">
                <div>
                  <dt className="text-sm font-semibold text-gray-900 dark:text-white">Email</dt>
                  <dd className="mt-1">
                    <a href="mailto:hello@cartze.shop" className="text-[15px] text-brand-500 hover:text-brand-600">
                      hello@cartze.shop
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-semibold text-gray-900 dark:text-white">Where we are</dt>
                  <dd className="mt-1 text-[15px] text-gray-600 dark:text-gray-400">Karachi, Pakistan</dd>
                </div>
                <div>
                  <dt className="text-sm font-semibold text-gray-900 dark:text-white">A walkthrough takes</dt>
                  <dd className="mt-1 text-[15px] text-gray-600 dark:text-gray-400">
                    About half an hour, on your own shop&rsquo;s data if you want it.
                  </dd>
                </div>
              </dl>
            </div>

            <div className="settles" style={{ "--settle-delay": "120ms" } as React.CSSProperties}>
              <EnquiryForm />
            </div>
          </div>
        </div>
      </section>

      {/* ══ CLOSE ════════════════════════════════════════════════════ */}
      <section className="landing-night relative overflow-hidden text-white">
        <div aria-hidden="true" className="landing-night-light pointer-events-none absolute inset-0 [--light-size:60%_70%] [--light-strength:32%] [--light-ends:70%]" />
        <div className="relative mx-auto max-w-3xl px-5 py-24 text-center sm:px-8 lg:py-32">
          <div className="settles">
            <h2 className="text-4xl font-bold leading-[1.06] tracking-[-0.02em] text-balance sm:text-5xl">
              Open a shop of your own and ring a sale
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-white/60">
              A real shop for your trade, stocked and ready, with a till that is
              already open. It is yours alone, and it clears itself away after a
              day if you decide against it.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <TryDemo big />
              <a
                href="#talk"
                className="rounded-xl border border-white/20 px-6 py-4 text-base font-semibold text-white transition hover:border-white/40 hover:bg-white/5"
              >
                Ask for a walkthrough
              </a>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
