import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { OrdersScreen } from "../modules/orders/screens/OrdersScreen";
import { OrderDetailScreen } from "../modules/orders/screens/OrderDetailScreen";
import type { OrdersStackParamList } from "./types";

const Stack = createNativeStackNavigator<OrdersStackParamList>();

/**
 * The queue, and one order behind it.
 *
 * Inside the tab rather than above it, so the tab bar stays put: a shopkeeper
 * working through four orders in a row should never lose the way back to
 * Today, and a detail screen that covers the whole app for that is a modal
 * pretending to be a page.
 */
export function OrdersStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="OrdersQueue" component={OrdersScreen} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
    </Stack.Navigator>
  );
}
