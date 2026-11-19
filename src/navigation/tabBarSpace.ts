import React from "react";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";

/**
 * HOW MUCH OF THE BOTTOM THE FLOATING TAB BAR COVERS — 0 off the tabs.
 *
 * The bar floats over the page now (foodpanda's, with no grey strip behind
 * it), so a tab screen's list must end above it or its last row sits under
 * the pill. Read from context rather than `useBottomTabBarHeight()`, which
 * throws on a screen that is also pushed outside the tabs (`ShopList`).
 */
export function useTabBarSpace(): number {
  return React.useContext(BottomTabBarHeightContext) ?? 0;
}
