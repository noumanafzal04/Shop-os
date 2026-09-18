import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MenuScreen } from "../modules/menu/screens/MenuScreen";
import { ProductDetailScreen } from "../modules/menu/screens/ProductDetailScreen";
import type { MenuStackParamList } from "./types";

const Stack = createNativeStackNavigator<MenuStackParamList>();

/** Same shape as OrdersStack, and for the same reason — the tab bar stays. */
export function MenuStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MenuList" component={MenuScreen} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} />
    </Stack.Navigator>
  );
}
