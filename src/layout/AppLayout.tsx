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

  return (
    <div className="min-h-screen xl:flex">
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
      <div
        className={`flex-1 transition-all duration-300 ease-in-out ${
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
