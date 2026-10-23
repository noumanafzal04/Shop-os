import {
  BoltIcon,
  BoxCubeIcon,
  BoxIcon,
  ChatIcon,
  DollarLineIcon,
  FileIcon,
  GridIcon,
  GroupIcon,
  InfoIcon,
  ListIcon,
  PaperPlaneIcon,
  PieChartIcon,
  TaskIcon,
  UserCircleIcon,
  UserIcon,
} from "../icons";
import type { NavItem } from "./navItem";

/**
 * The platform console's rail, by name. Its own file so the notice a refused
 * screen leaves (screenNames.ts) reads the very names the rail shows.
 */
export const adminMainItems: NavItem[] = [
  { icon: <GridIcon />, name: "Dashboard", path: "/admin" },
  { icon: <GroupIcon />, name: "Tenants", path: "/admin/tenants" },
  // NOT GroupIcon. It was the same glyph as Tenants directly above it, which
  // is the collision this rail has already been swept for once: two rows
  // wearing one icon is a rail you have to read word by word.
  // "Demo shops", not "Shop requests": the screen is every demo now — the
  // ones being tried as well as the ones that asked to stay. The badge is
  // still only the people WAITING, and the path has not moved.
  { icon: <TaskIcon />, name: "Demo shops", path: "/admin/shop-requests" },
  { icon: <PaperPlaneIcon />, name: "Enquiries", path: "/admin/enquiries" },
  { icon: <ListIcon />, name: "Plans", path: "/admin/plans" },
  // Riders waiting to be approved. On the MAIN rail rather than under
  // Platform, because it is a queue with people in it — the same shape as
  // Shop requests two rows up — and a queue nobody sees is a queue nobody
  // works.
  // A PACKAGE, not a person. `UserCircleIcon` is Platform Staff four rows
  // down, and two rows wearing one glyph is a rail you have to read word by
  // word — the collision this list was already swept for once.
  { icon: <BoxIcon />, name: "Riders", path: "/admin/riders" },
  { icon: <DollarLineIcon />, name: "Billing & Payments", path: "/admin/payments" },
  // Beside Billing, because both are money — and NOT merged into it, because
  // they are different debts. A plan is what a shop pays for the software;
  // commission is a share of what the marketplace sold for them.
  { icon: <PieChartIcon />, name: "Commission", path: "/admin/commission" },
];

export const adminPlatformItems: NavItem[] = [
  { icon: <BoltIcon />, name: "Configuration", path: "/admin/config" },
  { icon: <BoxCubeIcon />, name: "Banners / Ads", path: "/admin/banners" },
  { icon: <ChatIcon />, name: "Announcements", path: "/admin/announcements" },
  // A PERSON WHO SHOPS, as against Platform Staff below — different glyph on
  // purpose, since two rows wearing one icon is the collision this rail has
  // already been swept for twice.
  { icon: <UserIcon />, name: "Customers", path: "/admin/customers" },
  { icon: <UserCircleIcon />, name: "Platform Staff", path: "/admin/staff" },
  { icon: <FileIcon />, name: "Audit Log", path: "/admin/audit-logs" },
  { icon: <InfoIcon />, name: "Help Centre", path: "/admin/help" },
  // The QA walkthrough. On the admin rail and nowhere else: it is written for
  // whoever tests the product, and a shopkeeper has no use for a list of the
  // parts their shop was not given.
  { icon: <TaskIcon />, name: "QA walkthrough", path: "/admin/qa" },
];
