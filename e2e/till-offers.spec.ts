import { test } from "@playwright/test";
import { theTillOffersOnlyWhatTheShopHas } from "./tillOffers";

// The mart — the shop the report came from. See `tillOffers.ts`.
test("the till offers a mart only what a mart has", async ({ page }) => {
  await theTillOffersOnlyWhatTheShopHas(page);
});
