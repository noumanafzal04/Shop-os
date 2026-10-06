import { Outlet } from "react-router";
import { SidebarProvider } from "../context/SidebarContext";
import AppSidebar from "./AppSidebar";
import Backdrop from "./Backdrop";

/**
 * A WORK SCREEN STILL KNOWS WHERE THE REST OF THE SHOP IS.
 *
 *     "kot or dine in screen kam se kam chota sidebar to show hona chahye"
 *
 * The floor, the tab and the kitchen board run outside the app shell so the
 * work gets the whole screen. It also meant the only way off any of them was
 * one "‹ Dashboard" link: a manager on the floor who wanted the till, the
 * orders or today's sales went back to the dashboard first and out again.
 *
 * So these three keep the RAIL and nothing else of the shell — icons only,
 * ninety pixels, never pinned wide. Hovering it (or touching a group, on a
 * tablet) opens it OVER the page: the page does not move, because a kitchen
 * board that reflows when somebody's sleeve brushes the edge of the screen is
 * a board nobody can read.
 *
 * Below `lg` there is no room for a rail beside the work, and it is the same
 * drawer it is everywhere else — opened from the screen's own header, see
 * RailMenuButton.
 *
 * The till is NOT here, on purpose. A cashier's screen has no way out by
 * design; a sale is finished or parked before anything else is opened.
 */
export default function WorkScreenLayout() {
  return (
    <SidebarProvider iconsOnly>
      <AppSidebar />
      <Backdrop />
      {/* `min-w-0` for the reason AppLayout's page has it: without it one wide
          child pushes the whole screen past the edge of the window. */}
      <div className="min-w-0 lg:pl-[90px]">
        <Outlet />
      </div>
    </SidebarProvider>
  );
}
