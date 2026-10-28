import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useConnectionStore } from "../../stores/connectionStore";
import { PRODUCT } from "../../common/brand";

/**
 * A SCREEN THAT COULD NOT OPEN SAYS SO (offline #OF4).
 *
 * Every screen is a `lazy()` import: it arrives over the network the first
 * time it is opened. Offline, on a device that had never been on Take an
 * order, the import failed and the shopkeeper got a completely white page —
 * no heading, nothing to press — because nothing in the panel caught it. The
 * same white page follows a deploy, when the old hashed files are gone.
 *
 * Caught here, inside the layout, so the sidebar stays and the till is one
 * press away. A new screen clears it: a failure belongs to the screen it
 * happened on.
 */
export function ScreenCouldNotOpen({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  return <Boundary at={pathname}>{children}</Boundary>;
}

class Boundary extends Component<
  { at: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { at: string }) {
    if (prev.at !== this.props.at && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    return this.state.error === null ? (
      this.props.children
    ) : (
      <CouldNotOpen error={this.state.error} at={this.props.at} />
    );
  }
}

/** Chrome, Firefox and Safari each word a failed screen download their own way. */
const NOT_DOWNLOADED =
  /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i;

function CouldNotOpen({ error, at }: { error: Error; at: string }) {
  const connected = useConnectionStore((s) => s.online && s.reachable);
  const notDownloaded = NOT_DOWNLOADED.test(error.message);
  const offline = !connected;

  const [title, body] = offline
    ? [
        "This screen is not saved on this device yet",
        "It opens once the internet is back. The till keeps working offline on a device that has saved everything.",
      ]
    : notDownloaded
      ? [
          "This screen needs a fresh copy of the app",
          `${PRODUCT.name} was updated. Reload to open it — nothing you saved is lost.`,
        ]
      : [
          "This screen could not open",
          "Something went wrong while drawing it. Reload to try again; if it keeps happening, tell us which screen.",
        ];

  return (
    <div
      role="alert"
      data-screen-could-not-open
      className="mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <h1 className="text-lg font-semibold text-gray-800 dark:text-white/90">
        {title}
      </h1>
      <p className="mt-2 text-theme-sm text-gray-500 dark:text-gray-400">
        {body}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {offline && at.startsWith("/tenant") && at !== "/tenant/pos" && (
          <Link
            to="/tenant/pos"
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-theme-sm font-medium text-white hover:bg-brand-600"
          >
            Go to the till
          </Link>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-gray-300 px-4 py-2.5 text-theme-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
        >
          {offline ? "Try again" : "Reload"}
        </button>
      </div>
    </div>
  );
}
