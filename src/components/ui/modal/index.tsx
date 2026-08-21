import { useRef, useEffect, useId, useState, type ReactNode } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
  showCloseButton?: boolean; // New prop to control close button visibility
  isFullscreen?: boolean; // Default to false for backwards compatibility
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  className,
  showCloseButton = true, // Default to true for backwards compatibility
  isFullscreen = false,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const [named, setNamed] = useState(false);

  /**
   * A dialog needs a NAME, and the focus needs to be inside it.
   *
   * `role="dialog"` and `aria-modal="true"` were added first and on their own
   * they are half a fix: an unnamed dialog is announced as "dialog", and
   * `aria-modal` tells a reader the rest of the page is inert while the focus
   * is still standing out there in it — stranded in a page it has just been
   * told to ignore.
   *
   * The name is taken from the dialog's own heading rather than from a new prop,
   * because there are 107 call sites and every one of them already renders one.
   * Nothing to pass, nothing to forget.
   */
  useEffect(() => {
    if (!isOpen) {
      setNamed(false);

      return;
    }

    const panel = modalRef.current;
    if (panel === null) {
      return;
    }

    const heading = panel.querySelector("h1, h2, h3, h4, h5, h6");
    if (heading !== null) {
      if (heading.id === "") {
        heading.id = labelId;
      }
      setNamed(true);
    }

    // The panel itself, not the first control: landing on a control skips the
    // title, and a cashier using a keyboard should hear what opened before
    // being asked to fill it in.
    panel.focus({ preventScroll: true });
  }, [isOpen, labelId]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }

    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // A modal has to look lifted off the page, not printed on it.
  //
  // This panel carried NO shadow: a white sheet on a white page behind a 30%
  // scrim, with nothing but a corner radius to say it was in front. The shop
  // reported modals as "not opening properly" — which is what a dialog with no
  // edge looks like when you cannot tell it from the screen underneath.
  //
  // `shadow-2xl` does the lifting in light mode. The ring does it in dark,
  // where a shadow against a near-black page is invisible and the only thing
  // that can separate two dark surfaces is a lighter edge.
  const contentClasses = isFullscreen
    ? "w-full h-full"
    : "relative w-full rounded-3xl bg-white shadow-2xl ring-1 ring-gray-900/5 dark:bg-gray-900 dark:ring-white/10";

  return (
    /**
     * `items-center` and `overflow-y-auto` on the SAME element is the classic
     * trap: a modal taller than the window gets centred, which pushes its top
     * edge above the scroll container's origin — and nothing scrolls above
     * origin, so the head of the form (title, name, email) is unreachable on a
     * short laptop screen. Centring therefore happens on an inner wrapper with
     * `min-h-full`: short content still sits in the middle, tall content grows
     * the wrapper past the viewport and scrolls from its true top.
     */
    <div className="modal fixed inset-0 z-99999 overflow-y-auto">
      {/* Still NO blur — a 32px backdrop-blur made every modal open feel
          sluggish and buried the page behind fog, and that finding stands.
          The objection was to the BLUR, not to the opacity: at 30% the page
          behind stayed bright enough to compete with the dialog in front of
          it, which is half of why modals read as not-quite-open. Darker scrim,
          same instant paint. */}
      {!isFullscreen && (
        <div
          className="fixed inset-0 h-full w-full bg-gray-900/60 dark:bg-black/75"
          onClick={onClose}
        ></div>
      )}
      {/* The wrapper covers the scrim, so click-to-dismiss has to live here
          too — the panel below stops the event from reaching it. */}
      <div
        className={`relative flex min-h-full justify-center ${isFullscreen ? "items-stretch" : "items-center p-4"}`}
        onClick={onClose}
      >
      {/* `role="dialog"` + `aria-modal`, which this component had neither of.
          Every modal in the app was an anonymous div: a screen reader announced
          nothing when one opened, and nothing told it that the page behind was
          inert. It also made the whole app untestable by role — a browser test
          asking for the dialog it had just opened waited five minutes and
          timed out, which is how this was found. */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={named ? labelId : undefined}
        tabIndex={-1}
        className={`${contentClasses}  ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {showCloseButton && (
          <button
            onClick={onClose}
            // Icon-only, so without this it is announced as "button" and
            // nothing else — the one control every modal has, and the one a
            // person who cannot see the ✕ most needs named.
            aria-label="Close"
            className="absolute right-3 top-3 z-999 flex h-9.5 w-9.5 items-center justify-center rounded-full bg-gray-100 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white sm:right-6 sm:top-6 sm:h-11 sm:w-11"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M6.04289 16.5413C5.65237 16.9318 5.65237 17.565 6.04289 17.9555C6.43342 18.346 7.06658 18.346 7.45711 17.9555L11.9987 13.4139L16.5408 17.956C16.9313 18.3466 17.5645 18.3466 17.955 17.956C18.3455 17.5655 18.3455 16.9323 17.955 16.5418L13.4129 11.9997L17.955 7.4576C18.3455 7.06707 18.3455 6.43391 17.955 6.04338C17.5645 5.65286 16.9313 5.65286 16.5408 6.04338L11.9987 10.5855L7.45711 6.0439C7.06658 5.65338 6.43342 5.65338 6.04289 6.0439C5.65237 6.43442 5.65237 7.06759 6.04289 7.45811L10.5845 11.9997L6.04289 16.5413Z"
                fill="currentColor"
              />
            </svg>
          </button>
        )}
        <div>{children}</div>
      </div>
      </div>
    </div>
  );
};

/**
 * A modal that is a form.
 *
 * A long form — thirteen fields, a permission grid, a delivery breakdown — does
 * not fit a laptop screen. Left to grow it takes its title off the top and puts
 * the button that saves the work below the fold, so the two things you always
 * need are the two things you cannot see. This pins both ends and moves only
 * the middle.
 *
 * Pass it a Modal with no padding: `className="max-w-md"`, not `"max-w-md p-6"`
 * — the padding belongs to the three bands, or the header would scroll its own
 * whitespace.
 *
 * ── `dvh`, never `vh` ───────────────────────────────────────────────────
 *
 * The cap was `85vh`. `vh` is the LARGE viewport — the height the page would
 * have if the browser's address bar were hidden. On a phone or tablet it is
 * not hidden, so 85vh is closer to 100% of the glass, and with the overlay's
 * own padding around it the band that ends up past the bottom edge is the
 * FOOTER: the button that saves the work.
 *
 * The exact same unit had already done the exact same thing to the Appearance
 * canvas's Save. That one was reported by a shop. This one is the component
 * every long form in the app is built on, so it was the same bug with fifteen
 * more places to appear.
 */
export function ModalForm({ title, description, footer, children }: {
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex max-h-[85dvh] flex-col">
      <header className="shrink-0 border-b border-gray-200 px-6 py-5 pr-16 dark:border-gray-800">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">{title}</h3>
        {description && <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">{description}</p>}
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">{children}</div>
      {footer && (
        <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-800">
          {footer}
        </footer>
      )}
    </div>
  );
}
