import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import {
  LayoutDashboard,
  Package,
  ReceiptText,
  Wallet,
  ShoppingCart,
  Store,
  UserRound,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react-native";
import { useAuthStore } from "../stores/authStore";
import { useBootstrapSession } from "../modules/auth/hooks/useAuth";
import { SignInScreen } from "../modules/auth/screens/SignInScreen";
import { SignUpScreen } from "../modules/auth/screens/SignUpScreen";
import { HomeScreen } from "../modules/dashboard/screens/HomeScreen";
import { ShopSetupScreen } from "../modules/shop/screens/ShopSetupScreen";
import { ProductsScreen } from "../modules/catalog/screens/ProductsScreen";
import { ProductFormScreen } from "../modules/catalog/screens/ProductFormScreen";
import { AdjustStockScreen } from "../modules/inventory/screens/AdjustStockScreen";
import { SalesScreen } from "../modules/sales/screens/SalesScreen";
import { NewSaleScreen } from "../modules/sales/screens/NewSaleScreen";
import { ExpensesScreen } from "../modules/expenses/screens/ExpensesScreen";
import { AddExpenseScreen } from "../modules/expenses/screens/AddExpenseScreen";
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
import { CustomerHomeScreen } from "../modules/marketplace/screens/CustomerHomeScreen";
import { SearchScreen } from "../modules/marketplace/screens/SearchScreen";
import { LocationScreen } from "../modules/marketplace/screens/LocationScreen";
import { AccountScreen } from "../modules/account/screens/AccountScreen";
import { NotificationsScreen } from "../modules/account/screens/NotificationsScreen";
import { AddressesScreen } from "../modules/account/screens/AddressesScreen";
import { useCartStore } from "../stores/cartStore";
import { colors, radius, shadow, typography } from "../theme";
import type {
  AuthStackParamList,
  CustomerStackParamList,
  CustomerTabParamList,
  RootStackParamList,
  ShopStackParamList,
  ShopTabParamList,
} from "./types";

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const ShopStack = createNativeStackNavigator<ShopStackParamList>();
const CustomerStack = createNativeStackNavigator<CustomerStackParamList>();
const ShopTabs = createBottomTabNavigator<ShopTabParamList>();
const CustomerTabs = createBottomTabNavigator<CustomerTabParamList>();

const tabIcon = (Icon: LucideIcon) =>
  ({ focused, color }: { focused: boolean; color: string }) =>
    <Icon size={22} color={color} strokeWidth={focused ? 2.4 : 2} />;

/**
 * Tab bar sized WITH the device's bottom inset (gesture bar / home
 * indicator) — labels never collide with the system pill.
 */
function useTabScreenOptions() {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 8);

  return {
    headerShown: false,
    tabBarActiveTintColor: colors.brand[500],
    tabBarInactiveTintColor: colors.gray[400],
    tabBarStyle: {
      height: 56 + bottom,
      paddingTop: 6,
      paddingBottom: bottom,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    tabBarLabelStyle: { fontSize: 11, fontWeight: "600" as const },
  } as const;
}

// ── Guest: sign in / sign up / browse the market ────────────────────
function AuthArea() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="SignIn" component={SignInScreen} />
      <AuthStack.Screen name="SignUp" component={SignUpScreen} />
      <AuthStack.Screen name="Market" component={MarketScreen} />
      <AuthStack.Screen name="MarketShop" component={MarketShopScreen} />
    </AuthStack.Navigator>
  );
}

// ── Business side (unchanged) ───────────────────────────────────────
function ShopTabsArea() {
  const tabScreenOptions = useTabScreenOptions();
  return (
    <ShopTabs.Navigator screenOptions={tabScreenOptions}>
      <ShopTabs.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ title: "Dashboard", tabBarIcon: tabIcon(LayoutDashboard) }}
      />
      <ShopTabs.Screen
        name="ProductsTab"
        component={ProductsScreen}
        options={{ title: "Items", tabBarIcon: tabIcon(Package) }}
      />
      <ShopTabs.Screen
        name="SalesTab"
        component={SalesScreen}
        options={{ title: "Sales", tabBarIcon: tabIcon(ReceiptText) }}
      />
      <ShopTabs.Screen
        name="ExpensesTab"
        component={ExpensesScreen}
        options={{ title: "Expenses", tabBarIcon: tabIcon(Wallet) }}
      />
    </ShopTabs.Navigator>
  );
}

function ShopArea() {
  return (
    <ShopStack.Navigator screenOptions={{ headerShown: false }}>
      <ShopStack.Screen name="Tabs" component={ShopTabsArea} />
      <ShopStack.Screen name="ProductForm" component={ProductFormScreen} options={{ presentation: "modal" }} />
      <ShopStack.Screen name="AdjustStock" component={AdjustStockScreen} options={{ presentation: "modal" }} />
      <ShopStack.Screen name="NewSale" component={NewSaleScreen} options={{ presentation: "modal" }} />
      <ShopStack.Screen name="AddExpense" component={AddExpenseScreen} options={{ presentation: "modal" }} />
    </ShopStack.Navigator>
  );
}

// ── Customer side — footer: Home · Favorites · [Cart FAB] · Orders · Account
function CartFabButton({ onPress }: { onPress?: (e: unknown) => void }) {
  const count = useCartStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
  return (
    <Pressable style={fabStyles.wrap} onPress={onPress as never}>
      <View style={[fabStyles.fab, shadow.lg]}>
        <ShoppingCart size={22} color={colors.white} strokeWidth={2.2} />
        {count > 0 && (
          <View style={fabStyles.badge}>
            <Text style={fabStyles.badgeText}>{count > 99 ? "99+" : count}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function CustomerTabsArea() {
  const tabScreenOptions = useTabScreenOptions();
  return (
    <CustomerTabs.Navigator screenOptions={tabScreenOptions}>
      <CustomerTabs.Screen
        name="FoodTab"
        component={CustomerHomeScreen}
        options={{ title: "Food", tabBarIcon: tabIcon(UtensilsCrossed) }}
      />
      <CustomerTabs.Screen
        name="GroceryTab"
        component={MarketScreen}
        initialParams={{ business_type: "grocery", title: "Grocery" }}
        options={{ title: "Grocery", tabBarIcon: tabIcon(Store) }}
      />
      <CustomerTabs.Screen
        name="CartTab"
        component={CartScreen}
        options={{
          title: "",
          tabBarButton: (props) => <CartFabButton onPress={props.onPress as never} />,
        }}
      />
      <CustomerTabs.Screen
        name="OrdersTab"
        component={OrdersScreen}
        options={{ title: "Orders", tabBarIcon: tabIcon(ReceiptText) }}
      />
      <CustomerTabs.Screen
        name="AccountTab"
        component={AccountScreen}
        options={{ title: "Account", tabBarIcon: tabIcon(UserRound) }}
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
    </CustomerStack.Navigator>
  );
}

/**
 * Auth-driven navigation — one codebase, three experiences:
 *   guest     → AuthArea (sign in/up + guest market browsing)
 *   customer  → CustomerArea (market + favorites)
 *   business  → ShopArea (dashboard, items, sales, expenses)
 * The setup gate still blocks owners until onboarding completes.
 */
export function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  useBootstrapSession();

  // Push: register this device once signed in (no-op until Firebase is set up).
  React.useEffect(() => {
    if (status === "authenticated") initPush();
  }, [status]);

  if (status === "booting") {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color={colors.brand[500]} />
      </View>
    );
  }

  const needsSetup =
    status === "authenticated" &&
    user?.role === "shop_owner" &&
    user.tenant != null &&
    !user.tenant.setup_completed;

  return (
    <NavigationContainer ref={navigationRef} onReady={flushPendingDeepLink}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {status !== "authenticated" ? (
          <RootStack.Screen name="Auth" component={AuthArea} />
        ) : needsSetup ? (
          <RootStack.Screen name="ShopSetup" component={ShopSetupScreen} />
        ) : user?.role === "customer" ? (
          <RootStack.Screen name="Customer" component={CustomerArea} />
        ) : (
          <RootStack.Screen name="Shop" component={ShopArea} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
  },
});

// Center cart FAB — the raised green circle in the tab bar.
const fabStyles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  fab: {
    width: 54,
    height: 54,
    borderRadius: radius.full,
    backgroundColor: colors.brand[500],
    alignItems: "center",
    justifyContent: "center",
    marginTop: -22,
    borderWidth: 4,
    borderColor: colors.surface,
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: { ...typography.tiny, color: colors.white, fontWeight: "700", fontSize: 10 },
});
