import { SidebarProvider, useSidebar } from "../context/SidebarContext";
import { Outlet } from "react-router";
import DemoBanner from "../modules/landing/components/DemoBanner";
import AppHeader from "./AppHeader";
import Backdrop from "./Backdrop";
import AppSidebar from "./AppSidebar";
import { useMe } from "../modules/auth/hooks/useAuth";

const LayoutContent: React.FC = () => {
  const { railWide, isMobileOpen } = useSidebar();

  // Refresh the persisted session (incl. tenant.features) from the server on
  // every authenticated load. Without this the sidebar reads stale localStorage,
  // so admin module toggles / settings changes never surface until a full re-login.
  useMe();

  /*
   * `min-h-dvh`, not `min-h-screen`.
   *
   * `100vh` on iOS is the viewport WITH the browser chrome hidden, which is
   * taller than what is actually on screen while the address bar is showing.
   * As a MIN height on the shell that means the page is always a little taller
   * than the window, so a tablet has a small scroll even on a screen with
   * nothing to scroll — which is half of what "body scroll ho rahi hai"
   * describes. The rest of this codebase already says `dvh` everywhere it says
   * a height at all (the till, the customiser, the setup page); the shell was
   * the one that did not.
   *
   * Not measurable in a desktop browser: `vh` and `dvh` are the same number
   * where there is no toolbar to slide away.
   */
  return (
    <div className="min-h-dvh xl:flex">
      {/* THE SERVICE WORKER IS NOT REGISTERED HERE ANY MORE.
          AppLayout is the shell, and the till, the floor, the tab and the
          kitchen board all run OUTSIDE it — so a cashier who opened
          /tenant/pos directly registered nothing, precached nothing, and had
          no offline shell on the one screen that exists to survive an outage.
          It is registered by TenantThemed (every shop screen, shell or not)
          and by AdminShell. See ServiceWorkerHost. */}
      <div>
        <AppSidebar />
        <Backdrop />
      </div>
      {/* The page steps aside by exactly the rail's width — `railWide` is the
          same value the rail sizes itself from, so the two cannot drift. They
          did: the rail asked `isExpanded || isHovered || isMobileOpen` and this
          asked `isExpanded || isHovered`, and with the drawer flag set at `lg`
          or wider the rail drew 290 while the page moved 90. The dashboard ran
          underneath the sidebar, and a tablet turned upright was how the shop
          met it. */}
      {/* `min-w-0`, and it is load-bearing.
          A flex child's default `min-width: auto` refuses to shrink below its
          own content, so ONE wide table anywhere inside pushed the entire
          shell — header included — past the right edge of the window. The page
          then scrolled sideways with no scrollbar to say so, and the last
          column of every table on it simply was not there.
          It only ever showed at `xl` and up, because that is where this
          container becomes a flex row at all; below it the same markup is a
          block and behaves. So the widest screens were the broken ones, which
          is the opposite of where anybody looks. */}
      <div
        className={`flex-1 min-w-0 transition-all duration-300 ease-in-out ${
          railWide ? "lg:ml-[290px]" : "lg:ml-[90px]"
        } ${isMobileOpen ? "ml-0" : ""}`}
      >
        {/* Above the header, so it is the first thing on every screen of a
            demo and cannot be scrolled away from. Renders nothing at all for a
            real shop. */}
        <DemoBanner />
        <AppHeader />
        {/* `--pinned-bottom` is set by whatever is currently fixed to the
            bottom of the screen — the PWA install card, the update card — and
            is 0 when nothing is. Without it those cards sit ON the page at
            z-999998, on top of whatever the screen drew down there: on a tablet
            that was the "Shop street address" field. Reachable with a scroll,
            but a shop should not have to find that out by tapping a banner. */}
        <div className="p-4 mx-auto max-w-(--breakpoint-2xl) pb-[calc(1rem+var(--pinned-bottom,0px))] md:p-6 md:pb-[calc(1.5rem+var(--pinned-bottom,0px))]">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

const AppLayout: React.FC = () => {
  return (
    <SidebarProvider>
      <LayoutContent />
    </SidebarProvider>
  );
};

export default AppLayout;
