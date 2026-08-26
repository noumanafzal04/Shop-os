import { useState } from "react";
import { Outlet } from "react-router";

import { SiteFooter } from "../../landing/components/SiteFooter";
import { CartSheet } from "./CartSheet";
import { MarketHeader } from "./MarketHeader";

/**
 * THE STOREFRONT'S FRAME.
 *
 * Every marketplace page was rendering its own header, which is how the shop
 * page ended up with a basket the market page did not have — one surface grew
 * a feature and the others never heard about it. Header, basket sheet and
 * footer are declared once here and the pages are just what goes between.
 *
 * The footer is the LANDING page's own, deliberately: a customer who arrives
 * from the landing page and walks into the market should not feel handed to a
 * different company halfway through.
 */
export function MarketLayout() {
  const [cartOpen, setCartOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white/90">
      <MarketHeader onOpenCart={() => setCartOpen(true)} />

      <main className="flex-1">
        <Outlet context={{ openCart: () => setCartOpen(true) }} />
      </main>

      <SiteFooter />
      <CartSheet open={cartOpen} onClose={() => setCartOpen(false)} />
    </div>
  );
}
