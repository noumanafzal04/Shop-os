import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { AppButton } from "@cartze/core/ui/AppButton";
import {
  BanknoteIcon,
  BellIcon,
  BoxIcon,
  ClockIcon,
  FileTextIcon,
  GearIcon,
  LifeBuoyIcon,
  PersonIcon,
  PlusIcon,
  ReceiptIcon,
  SparkleIcon,
  SignOutIcon,
  TagIcon,
} from "@cartze/core/ui/icons";
import { useAuthStore } from "../../stores/authStore";
import { holds } from "../permissions";
import { BRAND } from "../brand";
import { tabsFor } from "../../navigation/tabsFor";
import { useOrders } from "../../modules/orders/hooks/useOrders";
import { useOrdersPause } from "../../modules/shop/hooks/useShop";
import { activePause, backAt } from "../../modules/shop/pause";
import { AppDrawer, type DrawerSection, type DrawerStatus } from "./AppDrawer";

interface DrawerApi {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const Ctx = createContext<DrawerApi>({ open: () => {}, close: () => {}, isOpen: false });

/** `useDrawer().open()` from any screen inside the tabs. */
export const useDrawer = () => useContext(Ctx);

/**
 * ONE DRAWER, MOUNTED ONCE, ABOVE THE TABS.
 *
 * ── Why it lives here and not on each screen ─────────────────────────
 *
 * A panel rendered per screen is a panel per screen: four of them, four copies
 * of the link list, and the day a link is added it is added three times and
 * forgotten once. This product has that scar — four guards reading one route
 * list, a page rule with two drifted copies. The links are built HERE, from
 * one array, and every screen just asks for it to open.
 *
 * ── What goes in it, and what does not ───────────────────────────────
 *
 * The bottom bar is the DAY: what is selling, what is waiting, what was taken.
 * The drawer is the SHOP: the things a shopkeeper sets up once and returns to
 * occasionally — the catalogue behind the menu, the shelves, the opening
 * hours. Putting "Categories" in the bottom bar would cost a tab that a shop
 * looks at forty times a day, to reach something opened twice a month.
 *
 * ── Every link is permission-checked, in the same place as the tabs ──
 *
 * `holds()`, not `permissions.includes()` — an owner's list is empty and the
 * server grants them everything by role. A drawer that hid Categories from the
 * shop's owner would be the tab bug again in a different shape.
 */
export function DrawerHost({ children }: { children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const nav = useNavigation<{ navigate: (screen: string, params?: object) => void }>();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);

  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  const takesOrders = holds(user, "orders.manage");
  // The same queries the tab bar and the Busy card already hold — no new calls.
  const waiting = useOrders({ status: "pending" }, takesOrders).data?.orders.length ?? 0;
  const pause = useOrdersPause();
  const until = activePause(pause.data);
  const status: DrawerStatus | undefined = !takesOrders
    ? undefined
    : until
      ? { label: `Busy · back ${backAt(until)}`, tone: "busy" }
      : { label: "Taking orders", tone: "open" };

  const sections = useMemo<DrawerSection[]>(() => {
    const canCatalog = holds(user, "products.manage") && user?.tenant?.features?.products === true;
    const tabs = tabsFor(user);
    const out: DrawerSection[] = [];

    /**
     * THE WHOLE PATH, FROM THE ROOT.
     *
     * This host wraps the tab navigator, so `useNavigation` here is the ROOT
     * stack's. `navigate("Menu", ...)` is a route the root does not have, and
     * react-navigation's answer to that is silence — the panel closed and
     * nothing moved, which is exactly what it did on the first run.
     *
     * The drawer reaches two levels down on purpose: Categories lives behind
     * the Menu tab, and a shopkeeper should not have to know that.
     */
    const toTab = (tab: string) => (screen: string) => () =>
      nav.navigate("Tabs", { screen: tab, params: { screen } });
    const toMenu = toTab("Menu");
    const toAccount = toTab("Account");
    const toOrders = toTab("Orders");
    const toMoney = toTab("Money");

    /*
     * TODAY first — the three places a shopkeeper goes forty times a day, so
     * the panel is a way to get there with the thumb already on the left,
     * not only a list of settings. Each one only when its tab is allowed.
     */
    const today: DrawerSection["items"] = [];
    if (tabs.includes("Orders")) {
      today.push({
        key: "orders",
        label: "Orders",
        hint: waiting > 0 ? "Waiting for you to accept" : "New, cooking, ready, out",
        icon: ReceiptIcon,
        badge: waiting,
        onPress: toOrders("OrdersQueue"),
      });
    }
    if (tabs.includes("Money")) {
      today.push(
        {
          key: "sales",
          label: "Sales",
          hint: "Every sale, and who paid",
          icon: FileTextIcon,
          onPress: toMoney("Sales"),
        },
        {
          key: "money",
          label: "Money",
          hint: "Takings, commission, expenses",
          icon: BanknoteIcon,
          onPress: toMoney("MoneyHome"),
        },
      );
    }
    if (today.length > 0) out.push({ title: "Today", items: today });

    if (canCatalog) {
      out.push({
        title: "Catalogue",
        items: [
          {
            key: "products",
            label: "All products",
            hint: "Everything you sell",
            icon: BoxIcon,
            onPress: toMenu("MenuList"),
          },
          {
            key: "add",
            label: "Add a product",
            hint: "Name, price, photo, sizes",
            icon: PlusIcon,
            onPress: toMenu("ProductForm"),
          },
          {
            key: "categories",
            label: "Categories",
            hint: "What a thing is",
            icon: TagIcon,
            onPress: toMenu("Categories"),
          },
          {
            key: "collections",
            label: "Collections",
            hint: "Shelves you arrange",
            icon: SparkleIcon,
            onPress: toMenu("Collections"),
          },
        ],
      });
    }

    out.push({
      title: "Shop",
      items: [
        {
          key: "shop",
          label: "Shop settings",
          hint: "Name, address, delivery",
          icon: GearIcon,
          onPress: toAccount("Shop"),
        },
        {
          key: "hours",
          label: "Opening hours",
          hint: "When you are open",
          icon: ClockIcon,
          onPress: toAccount("Hours"),
        },
        {
          key: "notifications",
          label: "Notifications",
          hint: "Orders and news from us",
          icon: BellIcon,
          onPress: toAccount("Notifications"),
        },
      ],
    });

    out.push({
      title: "You",
      items: [
        {
          key: "profile",
          label: "Your profile",
          hint: "Name, phone, password",
          icon: PersonIcon,
          onPress: toAccount("Profile"),
        },
        {
          key: "help",
          label: "Help",
          hint: "Questions, call or message us",
          icon: LifeBuoyIcon,
          onPress: toAccount("Help"),
        },
      ],
    });

    return out;
  }, [nav, user, waiting]);

  const api = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {/*
        `onOpen` is what turns the left edge of EVERY tab into a way in — the
        host wraps the whole tab navigator, so one line gives the gesture to
        four screens rather than four screens each remembering to ask.

        The hamburger stays. A gesture nobody is told about is not a control,
        it is a secret.
      */}
      <AppDrawer
        open={isOpen}
        onClose={close}
        onOpen={open}
        title={user?.tenant?.business_name ?? "Your shop"}
        subtitle={user?.name ?? undefined}
        sections={sections}
        status={status}
        version={`${BRAND.name} · v${BRAND.version}`}
        footer={
          <AppButton
            title="Sign out"
            variant="outline"
            icon={SignOutIcon}
            onPress={() => {
              close();
              void clear();
            }}
          />
        }
      />
    </Ctx.Provider>
  );
}
