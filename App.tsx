/**
 * ShopOS Mobile — app root.
 * Providers: SafeArea → React Query → OfflineBanner + auth-driven navigation.
 */

import React from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./src/common/api/queryClient";
import { OfflineBanner } from "./src/common/ui/OfflineBanner";
import { RootNavigator } from "./src/navigation/RootNavigator";

function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar barStyle="dark-content" />
        <OfflineBanner />
        <RootNavigator />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

export default App;
