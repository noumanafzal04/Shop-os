import { Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import SignInForm from "../../components/auth/SignInForm";
import ThemeTogglerTwo from "../../components/common/ThemeTogglerTwo";
import { Wordmark } from "../../components/brand/Brand";
import { PRODUCT } from "../../common/brand";

/**
 * SIGN IN (2026-11-01), asked for step by step: "center main … instead of
 * side", "not shadow card", "kam sy kam border to lgao card py", "dark touch
 * b do … primary color ki".
 *
 * It was a split screen — the form on the left, a dark panel with a small mark
 * and a tagline on the right, a panel a phone never showed. Now: a band of the
 * shop's primary colour across the top, lined with faint 45° strokes that
 * echo the cuts in the mark; the name in white on it; and one bordered card,
 * no shadow, standing across the band's edge. The same on every size, and the
 * eye goes to the one thing this screen is for.
 */
export default function SignIn() {
  return (
    <>
      <PageMeta title="Sign in" description={`Sign in to ${PRODUCT.name}`} />
      <div className="relative isolate flex min-h-dvh flex-col bg-gray-50 dark:bg-gray-950">
        {/* The band: primary, deepening to the top, with the mark's 45° strokes. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[50dvh] min-h-[320px] overflow-hidden bg-gradient-to-br from-brand-950 via-brand-900 to-brand-700">
          <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.045)_0_2px,transparent_2px_34px)]" />
          <div className="absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(102,197,224,0.28),transparent)]" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/10" />
        </div>

        {/* Centred both ways ("verticle center", 2026-11-01): the band ends at
            the middle of the screen, so the card always stands across its edge. */}
        <main className="flex flex-1 flex-col items-center justify-center px-5 py-10">
          <Link
            to="/"
            aria-label={`${PRODUCT.name} — go to the home page`}
            className="mb-8 inline-flex min-h-11 items-center rounded-lg px-2 transition-opacity hover:opacity-85"
          >
            <Wordmark tone="onDark" size={44} />
          </Link>

          <div className="w-full max-w-[440px] rounded-2xl border border-gray-200 bg-white p-6 sm:p-9 dark:border-white/10 dark:bg-gray-900">
            <SignInForm />
          </div>

          <p className="mt-8 max-w-[440px] text-center text-theme-xs leading-relaxed text-gray-500 dark:text-gray-400">
            The till that keeps selling — even when the internet does not.
          </p>
        </main>

        <div className="fixed bottom-6 right-6 z-50 hidden sm:block">
          <ThemeTogglerTwo />
        </div>
      </div>
    </>
  );
}
