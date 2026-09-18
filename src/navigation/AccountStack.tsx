import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AccountScreen } from "../modules/account/screens/AccountScreen";
import { ShopScreen } from "../modules/shop/screens/ShopScreen";
import { HoursScreen } from "../modules/shop/screens/HoursScreen";
import { HelpScreen } from "../modules/account/screens/HelpScreen";
import type { AccountStackParamList } from "./types";

const Stack = createNativeStackNavigator<AccountStackParamList>();

export function AccountStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AccountHome" component={AccountScreen} />
      <Stack.Screen name="Shop" component={ShopScreen} />
      <Stack.Screen name="Hours" component={HoursScreen} />
      <Stack.Screen name="Help" component={HelpScreen} />
    </Stack.Navigator>
  );
}
