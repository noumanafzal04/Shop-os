import { Link } from "react-router";
import { useAuthStore } from "../../../stores/authStore";
import { useLogout } from "../../auth/hooks/useAuth";
import { homeForRole } from "../../../common/routing/guards";

/**
 * Public storefront top bar — sign-in/up for guests, greeting + logout for
 * customers, and a "My business" shortcut for owners who wander in.
 */
export function MarketHeader() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useLogout();

  return (
    <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link to="/" className="text-xl font-bold text-brand-500">
          ShopOS <span className="font-normal text-gray-500">Market</span>
        </Link>

        <div className="flex items-center gap-4 text-sm">
          {!isAuthenticated ? (
            <>
              <Link to="/signin" className="text-gray-600 hover:text-gray-800 dark:text-gray-300">
                Sign in
              </Link>
              <Link
                to="/signup"
                className="rounded-lg bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-600"
              >
                Sign up
              </Link>
            </>
          ) : user?.role === "customer" ? (
            <>
              <Link to="/my-orders" className="text-gray-600 hover:text-brand-500 dark:text-gray-300">My orders</Link>
              <span className="text-gray-600 dark:text-gray-300">Hi, {user.name.split(" ")[0]}</span>
              <button
                onClick={() => logout.mutate()}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400"
              >
                Log out
              </button>
            </>
          ) : (
            <Link
              to={homeForRole(user?.role)}
              className="rounded-lg bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-600"
            >
              My dashboard
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
