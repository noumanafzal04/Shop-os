import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { apiPost } from "../../../common/api/client";
import { ApiError } from "../../../common/types/api";
import { Wordmark } from "../../../components/brand/Brand";
import PageMeta from "../../../components/common/PageMeta";
import { useAuthStore } from "../../../stores/authStore";
import type { User } from "../../auth/types";
import { TRADE_ICON, type TradeCode } from "../components/tradeIcon";
import { useSettlesIn } from "../components/useSettlesIn";

/**
 * PICK A TRADE, GET A SHOP.
 *
 * One screen, one decision, no form. A shopkeeper deciding whether to trust
 * their day's takings to this will not fill in a sign-up to look at it — and
 * the ones who would type an email at this point mostly type a false one. The
 * email is asked for on the way OUT, when they want to keep what they have been
 * playing with, and by then it is worth something to both sides.
 *
 * The trades are the same eight the product actually supports, in the words a
 * shopkeeper would use about themselves.
 */
const TRADES: Array<{ code: TradeCode; label: string; blurb: string }> = [
  { code: "food", label: "Restaurant & café", blurb: "Tables, kitchen dockets, dine-in" },
  { code: "mart", label: "Mart & grocery", blurb: "Weighing, packs, barcodes" },
  { code: "pharmacy", label: "Pharmacy", blurb: "Batches, expiry, prescriptions" },
  { code: "retail", label: "Retail store", blurb: "Sizes, colours, warranty" },
  { code: "services", label: "Salon & services", blurb: "Selling an hour, not a thing" },
  { code: "automotive", label: "Auto & tyre", blurb: "Bay board, vehicle history" },
  { code: "petroleum", label: "Petrol pump", blurb: "Meter rolls, dips, shifts" },
  { code: "finance", label: "Finance", blurb: "Every rupee, in and out" },
];

type DemoReply = {
  access_token: string;
  refresh_token: string;
  user: User;
  demo: { shop: string; business_type: string; expires_at: string | null };
};

export default function DemoPage() {
  useSettlesIn();
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<TradeCode | null>(null);

  const open = useMutation({
    mutationFn: (businessType: TradeCode) =>
      apiPost<DemoReply>("/demo", { business_type: businessType }),
    onSuccess: ({ data }) => {
      setAuth(data.user, data.access_token, data.refresh_token);
      navigate("/tenant", { replace: true });
    },
  });

  const choose = (code: TradeCode) => {
    // Latched, so the card the visitor pressed is the one that shows it is
    // working. A single global spinner on a grid of eight leaves nobody sure
    // which one they hit.
    setChosen(code);
    open.mutate(code);
  };

  return (
    <div className="min-h-dvh bg-white text-gray-900 dark:bg-gray-950 dark:text-white/90">
      <PageMeta
        title="Try CartZe — pick your trade"
        description="Open a working demo shop for your trade. No card, no phone call, no sign-up."
      />

      <header className="border-b border-gray-200/70 dark:border-white/10">
        <nav className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3.5">
          <Link to="/" aria-label="CartZe home"><Wordmark size={30} /></Link>
          <Link to="/signin" className="text-sm font-medium text-gray-600 transition hover:text-brand-500 dark:text-gray-300">
            I already have a shop
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-14 lg:py-20">
        <div className="settles text-center">
          <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            What kind of shop do you run?
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-gray-600 dark:text-gray-300">
            We will open one for you, stocked and ready to ring a sale. It is
            yours alone and it clears itself away after a day.
          </p>
        </div>

        {open.isError && (
          <div
            role="alert"
            className="mx-auto mt-8 max-w-lg rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-600 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400"
          >
            {/* THE SERVER'S OWN WORDS, and — when it is a rate limit — how
                long. "Try again in a moment" is the vague phrasing this
                codebase keeps rejecting elsewhere; the throttle knows the
                answer in seconds and there is no reason to withhold it.
                `instanceof ApiError` is also what tells the mutation-feedback
                guard this screen can speak at all. */}
            {open.error instanceof ApiError && open.error.status === 429
              ? "One at a time — you have opened a few already. Give it a minute and pick a trade again."
              : open.error instanceof ApiError
                ? open.error.message
                : "The demo shop could not be opened."}
            {" "}Or{" "}
            <a href="mailto:hello@cartze.shop" className="font-medium underline">tell us</a>.
          </div>
        )}

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {TRADES.map((trade, i) => {
            const Icon = TRADE_ICON[trade.code];
            const working = open.isPending && chosen === trade.code;

            return (
              <button
                key={trade.code}
                type="button"
                onClick={() => choose(trade.code)}
                // Every card is disabled while one is working: a second shop
                // created by an impatient double-press is a second shop
                // nobody asked for, and the visitor only sees the first.
                disabled={open.isPending}
                className="settles group flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-lg disabled:pointer-events-none disabled:opacity-60 dark:border-white/10 dark:bg-gray-900 dark:hover:border-brand-500/40"
                style={{ "--settle-delay": `${(i % 2) * 80 + Math.floor(i / 2) * 60}ms` } as React.CSSProperties}
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-500 group-hover:text-white dark:bg-brand-500/10 dark:text-brand-300">
                  {working ? (
                    <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.25" />
                      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <Icon />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{trade.label}</span>
                  <span className="mt-0.5 block text-sm text-gray-600 dark:text-gray-400">
                    {working ? "Opening your shop…" : trade.blurb}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <p className="settles mt-10 text-center text-sm text-gray-500 dark:text-gray-400">
          No card and no phone call. Nothing you do in a demo shop reaches a real
          customer.
        </p>
      </main>
    </div>
  );
}
