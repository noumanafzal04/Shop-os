import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useColors } from "@cartze/core/theme";
import { MenuScreen } from "../modules/menu/screens/MenuScreen";
import { ProductDetailScreen } from "../modules/menu/screens/ProductDetailScreen";
import { ProductFormScreen } from "../modules/menu/screens/ProductFormScreen";
import { CategoriesScreen } from "../modules/menu/screens/CategoriesScreen";
import { CollectionsScreen } from "../modules/menu/screens/CollectionsScreen";
import type { MenuStackParamList } from "./types";

const Stack = createNativeStackNavigator<MenuStackParamList>();

/** Same shape as OrdersStack, and for the same reason — the tab bar stays. */
export function MenuStack() {
  const c = useColors();

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        /**
         * THE HEADER WEARS THE PAGE'S COLOUR.
         *
         * react-navigation's default is a white bar, which over this app's
         * green-grey ground draws a hard horizontal edge across the top of
         * every pushed screen — the one part of the app that looked like it
         * came from somewhere else. `headerShadowVisible: false` for the same
         * reason: this design system separates with a border and a ground, and
         * an elevation shadow here is the only shadow in the app.
         */
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
        headerTitleStyle: { color: c.text },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="MenuList" component={MenuScreen} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} />
      {/*
        These two SHOW a header, where the list screens draw their own.
        A pushed screen with no header has no back button, and on Android the
        hardware back is the only way out — which works until somebody on a
        gesture-navigation phone is holding it one-handed mid-service.
      */}
      <Stack.Screen
        name="ProductForm"
        component={ProductFormScreen}
        options={{ headerShown: true, title: "Add an item" }}
      />
      <Stack.Screen
        name="Categories"
        component={CategoriesScreen}
        options={{ headerShown: true, title: "Categories" }}
      />
      <Stack.Screen
        name="Collections"
        component={CollectionsScreen}
        options={{ headerShown: true, title: "Collections" }}
      />
    </Stack.Navigator>
  );
}
