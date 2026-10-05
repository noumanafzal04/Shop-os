import { test } from "@playwright/test";
import { theTillOffersOnlyWhatTheShopHas } from "./tillOffers";

// Once per trade project, signed in as that trade's owner. See `tillOffers.ts`.
test("the till offers this trade only what it has", async ({ page }) => {
  await theTillOffersOnlyWhatTheShopHas(page);
});
