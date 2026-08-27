import React from "react";
import GridShape from "../../components/common/GridShape";
import { Link } from "react-router";
import ThemeTogglerTwo from "../../components/common/ThemeTogglerTwo";
import { Wordmark } from "../../components/brand/Brand";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative p-6 bg-white z-1 dark:bg-gray-900 sm:p-0">
      {/* `h-dvh`, not `h-screen`. `vh` is the viewport with the browser's
          address bar HIDDEN, which is not the viewport anybody signing in on a
          phone is looking at — it puts the bottom of the form under the
          chrome. */}
      <div className="relative flex flex-col justify-center w-full h-dvh lg:flex-row dark:bg-gray-900 sm:p-0">
        {/* THE LOGO EXISTED ONLY ON A DESKTOP.
            It lives in the brand panel below, and that panel is `hidden
            lg:grid` — so on every phone and every tablet under 1024px the
            sign-in screen carried no mark at all, and the only route back to
            the site was the browser's own back button. The one screen a
            stranger is most likely to arrive on cold was the one screen that
            never said whose it was. */}
        <div className="flex flex-col flex-1">
          <div className="flex justify-center pb-6 pt-2 lg:hidden">
            <Link
              to="/"
              aria-label="CartZe — go to the home page"
              className="inline-flex min-h-11 items-center rounded-lg px-2 transition-opacity hover:opacity-80"
            >
              {/* `auto`, not `onDark`: this half of the screen is white in
                  light mode. The panel's copy stays `onDark` because it sits
                  on brand-950 in both themes. */}
              <Wordmark size={38} />
            </Link>
          </div>
          {children}
        </div>
        <div className="items-center hidden w-full h-full lg:w-1/2 bg-brand-950 dark:bg-white/5 lg:grid">
          <div className="relative flex items-center justify-center z-1">
            {/* <!-- ===== Common Grid Shape Start ===== --> */}
            <GridShape />
            <div className="flex flex-col items-center max-w-xs">
              <Link to="/" className="mb-4 block">
                <Wordmark tone="onDark" size={48} />
              </Link>
              <p className="text-center text-gray-400 dark:text-white/60">
                Run your business. Sell everywhere.
              </p>
            </div>
          </div>
        </div>
        <div className="fixed z-50 hidden bottom-6 right-6 sm:block">
          <ThemeTogglerTwo />
        </div>
      </div>
    </div>
  );
}
