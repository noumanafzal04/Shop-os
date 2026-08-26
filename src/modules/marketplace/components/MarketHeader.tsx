import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";

import { homeForRole } from "../../../common/routing/guards";
import { Wordmark } from "../../../components/brand/Brand";
import { useToast } from "../../../components/ui/toast";
import { useAuthStore } from "../../../stores/authStore";
import { useCartStore } from "../../../stores/cartStore";
import { useSavedStore } from "../../../stores/savedStore";
import { useLogout } from "../../auth/hooks/useAuth";
import { useCities } from "../../shop/hooks/useShop";
import { CartIcon, ChevronDownIcon, HeartIcon, PinIcon, SearchIcon } from "./MarketIcons";

const NAV = [
  { to: "/shops", label: "Home" },
  { to: "/browse", label: "Browse" },
  { to: "/browse?in_stock=1&on_sale=1", label: "Deals" },
];

/**
 * THE STOREFRONT'S TOP BAR.
 *
 * The old one was a sign-in strip with a wordmark typed as text beside it. It
 * could not search, could not say which city you were shopping, and had no
 * basket — so the only way to reach a cart was to be standing inside the one
 * shop that owned it.
 *
 * A storefront header has four jobs and they are all here: say where you are,
 * let you search anything, say where you are shopping, and show what is in the
 * basket. Everything else is secondary and lives behind the account menu.
 */
export function MarketHeader({ onOpenCart }: { onOpenCart?: () => void }) {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useLogout();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const count = useCartStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
  const savedCount = useSavedStore((s) => s.ids.length);

  const cities = useCities();
  const cityId = params.get("city_id") ?? "";
  const cityName = cities.data?.find((c) => c.id === cityId)?.name ?? "All cities";

  const [term, setTerm] = useState(params.get("q") ?? "");
  const [menu, setMenu] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const account = useRef<HTMLDivElement>(null);
  const cityBox = useRef<HTMLDivElement>(null);

  // The box shows what is actually being searched. Arriving from a card, a
  // deep link or the back button must all fill it, or the header contradicts
  // the grid under it.
  useEffect(() => setTerm(params.get("q") ?? ""), [params]);

  // Click-away for both poppers. One listener, because two would each fight to
  // close the other's panel on the same click.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (account.current && !account.current.contains(e.target as Node)) setMenu(false);
      if (cityBox.current && !cityBox.current.contains(e.target as Node)) setCityOpen(false);
    };
    document.addEventListener("mousedown", away);

    return () => document.removeEventListener("mousedown", away);
  }, []);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    if (term.trim()) next.set("q", term.trim());
    if (cityId) next.set("city_id", cityId);
    navigate(`/browse?${next.toString()}`);
  };

  const chooseCity = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("city_id", id);
    else next.delete("city_id");
    next.delete("page");
    setCityOpen(false);
    // Stay where you are if you are already browsing; otherwise go and browse.
    navigate(`${location.pathname.startsWith("/browse") ? "/browse" : location.pathname}?${next.toString()}`);
  };

  const here = (to: string) => location.pathname === to.split("?")[0] && (to.includes("?") ? location.search.includes(to.split("?")[1]!) : true);

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/85 backdrop-blur-xl dark:border-white/10 dark:bg-gray-950/85">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-5 sm:px-6">
        <Link to="/shops" aria-label="CartZe marketplace" className="shrink-0">
          <Wordmark size={28} tone="auto" />
        </Link>

        {/* Where you are shopping. Beside the search box, not buried in the
            filters, because it changes what the whole page means. */}
        <div ref={cityBox} className="relative hidden shrink-0 md:block">
          <button
            type="button"
            onClick={() => setCityOpen((was) => !was)}
            aria-expanded={cityOpen}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-brand-300 hover:text-brand-600 dark:border-white/10 dark:text-gray-200"
          >
            <PinIcon className="size-4 text-brand-500" />
            <span className="max-w-28 truncate">{cityName}</span>
            <ChevronDownIcon className="size-3.5 text-gray-400" />
          </button>

          {cityOpen && (
            <div className="absolute left-0 top-full z-50 mt-2 max-h-72 w-56 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-gray-900">
              <button
                type="button"
                onClick={() => chooseCity("")}
                className={`flex w-full items-center rounded-xl px-3 py-2 text-sm transition ${
                  cityId === "" ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5"
                }`}
              >
                All cities
              </button>
              {(cities.data ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => chooseCity(c.id)}
                  className={`flex w-full items-center rounded-xl px-3 py-2 text-sm transition ${
                    cityId === c.id ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* One box for everything — a product, a brand, a shop's own name. */}
        <form onSubmit={search} className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-gray-400" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            type="search"
            aria-label="Search products and shops"
            placeholder="Search products, brands and shops…"
            className="h-11 w-full rounded-2xl border border-gray-200 bg-gray-50 pl-11 pr-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-brand-400 focus:bg-white dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:bg-white/10"
          />
        </form>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                here(item.to)
                  ? "bg-gray-100 text-gray-900 dark:bg-white/10 dark:text-white"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1">
          <Link
            to="/saved"
            aria-label={`Saved items${savedCount > 0 ? ` (${savedCount})` : ""}`}
            className="relative hidden rounded-xl p-2.5 text-gray-600 transition hover:bg-gray-100 hover:text-rose-500 sm:block dark:text-gray-300 dark:hover:bg-white/5"
          >
            <HeartIcon className="size-5" filled={savedCount > 0} />
            {savedCount > 0 && (
              <span className="absolute right-1 top-1 size-2 rounded-full bg-rose-500" />
            )}
          </Link>

          <button
            type="button"
            onClick={onOpenCart}
            aria-label={`Basket${count > 0 ? `, ${count} items` : ", empty"}`}
            className="relative rounded-xl p-2.5 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white"
          >
            <CartIcon className="size-5" />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-brand-500 px-1 text-[11px] font-bold tabular-nums text-white">
                {count > 99 ? "99+" : count}
              </span>
            )}
          </button>

          {!isAuthenticated ? (
            <Link
              to="/signin"
              className="ml-1 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600"
            >
              Sign in
            </Link>
          ) : (
            <div ref={account} className="relative ml-1">
              <button
                type="button"
                onClick={() => setMenu((was) => !was)}
                aria-expanded={menu}
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/5"
              >
                <span className="grid size-8 place-items-center rounded-full bg-brand-500 text-xs font-bold text-white">
                  {user?.name?.trim()[0]?.toUpperCase() ?? "?"}
                </span>
                <span className="hidden max-w-24 truncate sm:inline">{user?.name?.split(" ")[0]}</span>
                <ChevronDownIcon className="hidden size-3.5 text-gray-400 sm:block" />
              </button>

              {menu && (
                <div className="absolute right-0 top-full z-50 mt-2 w-52 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-gray-900">
                  {user?.role === "customer" ? (
                    <>
                      <MenuLink to="/my-orders" onGo={() => setMenu(false)}>My orders</MenuLink>
                      <MenuLink to="/saved" onGo={() => setMenu(false)}>Saved items</MenuLink>
                    </>
                  ) : (
                    <MenuLink to={homeForRole(user?.role)} onGo={() => setMenu(false)}>My dashboard</MenuLink>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      logout.mutate(undefined, {
                        // Signing out and staying signed in, with nothing said,
                        // is the one failure here somebody needs to know about
                        // — on a shared or borrowed phone especially.
                        onError: () => toast.error("Couldn't sign you out. Check your connection and try again."),
                      })
                    }
                    className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Small screens get the nav on its own row rather than losing it —
          "Browse" and "Deals" are the two things this header is for. */}
      <div className="flex items-center gap-1 overflow-x-auto border-t border-gray-100 px-4 py-2 lg:hidden dark:border-white/5">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              here(item.to)
                ? "bg-gray-100 text-gray-900 dark:bg-white/10 dark:text-white"
                : "text-gray-600 dark:text-gray-300"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </header>
  );
}

function MenuLink({ to, onGo, children }: { to: string; onGo: () => void; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      onClick={onGo}
      className="flex items-center rounded-xl px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5"
    >
      {children}
    </Link>
  );
}
