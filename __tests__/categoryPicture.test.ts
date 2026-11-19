import { categoryPicture, knowsCategory, picture, tradePicture } from "../src/modules/marketplace/tradePicture";

/**
 * A CATEGORY GETS ITS OWN PICTURE — not its trade's.
 *
 * "Lazmi ni retail main shirt e aye gi, food main burger": a pizza place, a
 * cafe and a karahi house are all `food`, and a shoe shop is `retail`.
 */
describe("the picture for a kind of shop", () => {
  it.each([
    ["fast_food", "food", "hamburger"],
    ["cafe", "food", "hot_beverage"],
    ["bakery", "food", "croissant"],
    ["restaurant", "food", "shallow_pan_of_food"],
    ["juice_corner", "food", "tropical_drink"],
    ["footwear", "retail", "running_shoe"],
    ["electronics", "retail", "laptop"],
    ["mobile_accessories", "retail", "mobile_phone"],
    ["garments", "retail", "t_shirt"],
    ["medical_store", "pharmacy", "pill"],
    ["surgical", "pharmacy", "syringe"],
    ["tyre_shop", "automotive", "wheel"],
    ["barber", "services", "barber_pole"],
    ["dairy_shop", "mart", "glass_of_milk"],
  ] as const)("%s (%s) → %s", (value, trade, art) => {
    expect(categoryPicture(value, null, trade)).toBe(picture(art));
  });

  it("names every category the platform offers today", () => {
    // From `GET /marketplace/categories` — a category with no mapping falls
    // back to its trade's picture, which is the shirt-for-every-shop problem.
    const all = [
      "restaurant",
      "fast_food",
      "cafe",
      "bakery",
      "cloud_kitchen",
      "juice_corner",
      "home_kitchen",
      "grocery",
      "supermarket",
      "general_store",
      "mini_mart",
      "convenience_store",
      "dairy_shop",
      "garments",
      "footwear",
      "electronics",
      "mobile_accessories",
      "cosmetics",
      "toys",
      "gifts",
      "sports",
      "books_stationery",
      "hardware",
      "jewellery",
      "home_appliances",
      "medical_store",
      "surgical",
      "homeopathic",
      "clinic_pharmacy",
      "tyre_shop",
      "battery_shop",
      "auto_parts",
      "auto_workshop",
      "oil_change",
      "car_wash",
      "bike_workshop",
      "petrol_pump",
      "cng_station",
      "diesel_station",
      "lubricants_shop",
      "salon_beauty",
      "barber",
      "spa",
      "mobile_repair",
      "computer_repair",
      "tailor",
      "laundry",
      "printing",
      "photography",
      "clinic",
      "online_boutique",
      "handmade",
      "electronics_online",
      "beauty_online",
      "distributor",
      "manufacturer",
      "importer",
      "cloth_wholesale",
      "grocery_wholesale",
      "hardware_wholesale",
      "electronics_wholesale",
      "cosmetics_wholesale",
    ];
    expect(all.filter((v) => !knowsCategory(v))).toEqual([]);
  });

  it("reads the words of a name it has no code for", () => {
    expect(categoryPicture("custom_1", "Pizza Point", "food")).toBe(picture("pizza"));
    expect(categoryPicture(null, "Lahori Biryani", "food")).toBe(picture("curry_rice"));
    expect(categoryPicture(null, "Shoe Corner", "retail")).toBe(picture("running_shoe"));
    expect(categoryPicture(null, "CHAI WALA", null)).toBe(picture("hot_beverage"));
  });

  it("falls back to the trade, then to the corner shop", () => {
    expect(categoryPicture("zz", "Zz", "pharmacy")).toBe(tradePicture("pharmacy"));
    expect(categoryPicture(null, null, null)).toBe(picture("convenience_store"));
    expect(categoryPicture("", "", "")).toBe(picture("convenience_store"));
  });

  it("does not let a code's case decide", () => {
    expect(categoryPicture("FAST_FOOD", null, "food")).toBe(picture("hamburger"));
  });

  it("a trade named a 'Store' is not a grocery — Retail Store drew a cart", () => {
    expect(categoryPicture(null, "Retail Store", "retail")).toBe(picture("shopping_bags"));
    expect(categoryPicture(null, "Retail Store", "retail")).not.toBe(picture("shopping_cart"));
    expect(categoryPicture(null, "Mart & Grocery", "mart")).toBe(picture("shopping_cart"));
    expect(categoryPicture(null, "Smart Phones", "retail")).toBe(picture("mobile_phone"));
  });
});
