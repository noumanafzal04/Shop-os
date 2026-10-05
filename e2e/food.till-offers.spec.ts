import { test } from "@playwright/test";
import { theTillOffersOnlyWhatTheShopHas } from "./tillOffers";

// The restaurant: no Quotes and no Coupons by default. See `tillOffers.ts`.
test("the till offers a restaurant only what a restaurant has", async ({ page }) => {
  await theTillOffersOnlyWhatTheShopHas(page);
});
