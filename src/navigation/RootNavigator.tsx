import React from "react";
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type Theme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useAuthStore } from "../stores/authStore";
import { useBootstrapSession } from "../modules/auth/hooks/useAuth";
import { SignInScreen } from "../modules/auth/screens/SignInScreen";
import { SignUpScreen } from "../modules/auth/screens/SignUpScreen";
import { BusinessAccountScreen } from "../modules/auth/screens/BusinessAccountScreen";
import { MarketScreen } from "../modules/marketplace/screens/MarketScreen";
import { MarketShopScreen } from "../modules/marketplace/screens/MarketShopScreen";
import { FavoritesScreen } from "../modules/marketplace/screens/FavoritesScreen";
import { ReservationsScreen } from "../modules/marketplace/screens/ReservationsScreen";
import { OrdersScreen } from "../modules/orders/screens/OrdersScreen";
import { CheckoutScreen } from "../modules/orders/screens/CheckoutScreen";
import { CartScreen } from "../modules/orders/screens/CartScreen";
import { OrderTrackingScreen } from "../modules/orders/screens/OrderTrackingScreen";
import { flushPendingDeepLink, navigationRef } from "./deepLinks";
import { initPush } from "../services/push";
import { useAppLinks } from "../services/appLinks";
import { AppTabBar } from "./AppTabBar";
import { Splash } from "../common/ui/Splash";
import { CustomerHomeScreen } from "../modules/marketplace/screens/CustomerHomeScreen";
import { SearchScreen } from "../modules/marketplace/screens/SearchScreen";
import { LocationScreen } from "../modules/marketplace/screens/LocationScreen";
import { AccountScreen } from "../modules/account/screens/AccountScreen";
import { NotificationsScreen } from "../modules/account/screens/NotificationsScreen";
import { BrowseScreen } from "../modules/marketplace/screens/BrowseScreen";
import { SettingsScreen } from "../modules/account/screens/SettingsScreen";
import { HelpScreen } from "../modules/account/screens/HelpScreen";
import { ProfileScreen } from "../modules/account/screens/ProfileScreen";
import { AddressesScreen } from "../modules/account/screens/AddressesScreen";
import { useColors, useTheme } from "../theme";
import type {
  CustomerStackParamList,
  CustomerTabParamList,
  RootStackParamList,
} from "./types";

const RootStack = createNativeStackNavigator<RootStackParamList>();
const CustomerStack = createNativeStackNavigator<CustomerStackParamList>();
const CustomerTabs = createBottomTabNavigator<CustomerTabParamList>();

// Hoisted: an arrow in the prop is a NEW component type on every render, and
// React then throws away the bar and its state each time the tabs re-render.
const renderTabBar = (props: BottomTabBarProps) => <AppTabBar {...props} />;

function CustomerTabsArea() {
  const c = useColors();

  return (
    <CustomerTabs.Navigator
      tabBar={renderTabBar}
      screenOptions={{
        headerShown: false,
        // The bar floats over the content, so the content has to end above it.
        // Without this the last row of every list sits underneath the pill and
        // cannot be tapped — the standing cost of a floating navigation.
        //
        // `sceneStyle`, not `sceneContainerStyle`: the navigator-level prop was
        // removed in bottom-tabs v7 and passing it is silently ignored.
        // NO bottom padding.
        //
        // The bar used to float over the content (`position: absolute`), so
        // every scene had to end above it or its last row was untappable. It
        // is now a plain bar in the layout and the navigator sizes the scene
        // above it — the padding that was load-bearing then is a dead strip
        // now, and a strip of a slightly different white under the bar is
        // most of what made the old one look like it was resting on a plate.
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <CustomerTabs.Screen
        name="FoodTab"
        component={CustomerHomeScreen}
      />
      <CustomerTabs.Screen
        name="GroceryTab"
        component={MarketScreen}
        initialParams={{ business_type: "grocery", title: "Grocery" }}
      />
      <CustomerTabs.Screen
        name="CartTab"
        component={CartScreen}
      />
      <CustomerTabs.Screen
        name="OrdersTab"
        component={OrdersScreen}
      />
      <CustomerTabs.Screen
        name="AccountTab"
        component={AccountScreen}
      />
    </CustomerTabs.Navigator>
  );
}

function CustomerArea() {
  return (
    <CustomerStack.Navigator screenOptions={{ headerShown: false }}>
      <CustomerStack.Screen name="Tabs" component={CustomerTabsArea} />
      <CustomerStack.Screen name="MarketShop" component={MarketShopScreen} />
      <CustomerStack.Screen name="Checkout" component={CheckoutScreen} options={{ presentation: "modal" }} />
      <CustomerStack.Screen name="Search" component={SearchScreen} />
      <CustomerStack.Screen name="ShopList" component={MarketScreen} />
      <CustomerStack.Screen name="Order" component={OrderTrackingScreen} />
      <CustomerStack.Screen name="Location" component={LocationScreen} options={{ presentation: "modal" }} />
      <CustomerStack.Screen name="Favorites" component={FavoritesScreen} />
      <CustomerStack.Screen name="Reservations" component={ReservationsScreen} />
      <CustomerStack.Screen name="Notifications" component={NotificationsScreen} />
      <CustomerStack.Screen name="Addresses" component={AddressesScreen} />
      <CustomerStack.Screen name="Settings" component={SettingsScreen} />
      <CustomerStack.Screen name="Help" component={HelpScreen} />
      <CustomerStack.Screen name="Profile" component={ProfileScreen} />
      <CustomerStack.Screen name="Browse" component={BrowseScreen} />

      {/*
        Signing in is a MODAL on the shopping stack, not a screen in front of
        it. The basket, the shop being read and the scroll position all stay
        mounted underneath, so someone who signs in at checkout comes back to
        their own checkout rather than to a home screen.
      */}
      <CustomerStack.Screen name="SignIn" component={SignInScreen} options={{ presentation: "modal" }} />
      <CustomerStack.Screen name="SignUp" component={SignUpScreen} options={{ presentation: "modal" }} />
    </CustomerStack.Navigator>
  );
}

/**
 * Auth-driven navigation.
 *
 * A GUEST gets the whole shop: browse, search, a basket, the lot. An account is
 * asked for at the two places that genuinely need one — placing an order and
 * reading an order history — and asked for in place, by `SignInWall`, with the
 * basket still behind it.
 *
 * The guest and the customer share ONE navigator rather than having a stack
 * each. That is the load-bearing part: two stacks means signing in swaps the
 * whole tree, and the checkout somebody was standing on unmounts at the exact
 * moment they finish proving who they are.
 *
 * Anyone else — a shop owner, their staff, a platform admin — has a real
 * session and no place to spend it here, so they land on
 * `BusinessAccountScreen`, which says so and offers the web panel.
 *
 * Note the shape of that last branch: it is `role === "customer"` that opens
 * the shop, not `role !== "shop_owner"` that closes it. A role added to the
 * backend tomorrow then lands on the notice, which is wrong but harmless and
 * visible — where the other spelling would drop an unknown role straight into
 * the customer app holding somebody else's session.
 */
export function RootNavigator() {
  const c = useColors();
  const { isDark } = useTheme();

  /**
   * The navigator's OWN colours, which are not the app's until told.
   *
   * `NavigationContainer` had no theme, so every surface React Navigation
   * paints itself — the ground under a scene, the card behind a transition —
   * came from `DefaultTheme`: a light grey, in BOTH themes. It shows wherever
   * a screen does not cover it, and the clearest case is the tab bar's rounded
   * top corners, which on a dark page were two bright notches cut out of the
   * bar. Nothing in our palette was wrong; the palette simply was not being
   * asked.
   */
  const navTheme: Theme = React.useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: c.bg,
        card: c.surface,
        text: c.text,
        border: c.border,
        primary: c.primary,
        notification: c.primary,
      },
    };
  }, [c, isDark]);

  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  useBootstrapSession();
  // A shared link, tapped outside the app. Signed in or not: a guest may open
  // a shop and see the menu, which is the point of sharing one.
  useAppLinks();

  // Push: register this device once signed in (no-op until Firebase is set up).
  React.useEffect(() => {
    if (status === "authenticated") initPush();
  }, [status]);

  // Not a spinner on a white page: the launcher's own frame is brand red now
  // (`android/app/src/main/res/values/styles.xml`), so this continues that
  // colour and nothing flashes between tapping the icon and the first screen.
  if (status === "booting") return <Splash />;

  return (
    <NavigationContainer theme={navTheme} ref={navigationRef} onReady={flushPendingDeepLink}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {/*
        `user != null` matters as much as the role test.

        The session now opens the app the moment tokens are found and fetches
        the profile behind it, so there is a window where the status is
        authenticated and the user is still null. `user?.role !== "customer"`
        is TRUE for null — which would have shown "you are in the wrong app" to
        every returning customer for as long as their profile took to load.
      */}
      {status === "authenticated" && user != null && user.role !== "customer" ? (
          <RootStack.Screen name="BusinessAccount" component={BusinessAccountScreen} />
        ) : (
          <RootStack.Screen name="Customer" component={CustomerArea} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}



