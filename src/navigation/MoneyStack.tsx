import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MoneyScreen } from "../modules/money/screens/MoneyScreen";
import { CommissionScreen } from "../modules/money/screens/CommissionScreen";
import { ExpenseEntryScreen } from "../modules/money/screens/ExpenseEntryScreen";
import { SalesScreen } from "../modules/sales/screens/SalesScreen";
import { SaleDetailScreen } from "../modules/sales/screens/SaleDetailScreen";
import type { MoneyStackParamList } from "./types";

const Stack = createNativeStackNavigator<MoneyStackParamList>();

export function MoneyStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MoneyHome" component={MoneyScreen} />
      <Stack.Screen name="Commission" component={CommissionScreen} />
      {/* A form, presented as a page: it is a task with a Back, not a modal
          somebody can swipe away half-finished. */}
      <Stack.Screen name="ExpenseEntry" component={ExpenseEntryScreen} />
      {/* The ledger, and one sale behind it — pushed, so Back returns to the
          list at the scroll position it was left at. */}
      <Stack.Screen name="Sales" component={SalesScreen} />
      <Stack.Screen name="SaleDetail" component={SaleDetailScreen} />
    </Stack.Navigator>
  );
}
