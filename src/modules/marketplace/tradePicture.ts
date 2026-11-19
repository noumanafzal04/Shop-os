import type { ImageSourcePropType } from "react-native";

/**
 * THE 3D PICTURES — foodpanda's style of category art, licensed and bundled.
 *
 * "Icons ajeeb sy lg rhy" / "foodpanda type images ni add kr skty?" The tiles
 * carried line glyphs, which read as a settings menu rather than as a shop
 * window. These are Microsoft's Fluent Emoji 3D (MIT — see
 * `assets/art/LICENSE.md`), the same rounded 3D look, the SAME on every phone
 * (a phone's own emoji differ by maker), bundled at 160px — about 19 KB each,
 * nothing downloaded at run time.
 */
const ART = {
  automobile: require("../../assets/art/automobile.png"),
  books: require("../../assets/art/books.png"),
  broccoli: require("../../assets/art/broccoli.png"),
  coin: require("../../assets/art/coin.png"),
  convenience_store: require("../../assets/art/convenience_store.png"),
  croissant: require("../../assets/art/croissant.png"),
  dollar_banknote: require("../../assets/art/dollar_banknote.png"),
  fuel_pump: require("../../assets/art/fuel_pump.png"),
  glowing_star: require("../../assets/art/glowing_star.png"),
  hamburger: require("../../assets/art/hamburger.png"),
  hammer_and_wrench: require("../../assets/art/hammer_and_wrench.png"),
  label: require("../../assets/art/label.png"),
  leafy_green: require("../../assets/art/leafy_green.png"),
  lipstick: require("../../assets/art/lipstick.png"),
  money_bag: require("../../assets/art/money_bag.png"),
  motor_scooter: require("../../assets/art/motor_scooter.png"),
  package: require("../../assets/art/package.png"),
  pill: require("../../assets/art/pill.png"),
  receipt: require("../../assets/art/receipt.png"),
  red_heart: require("../../assets/art/red_heart.png"),
  round_pushpin: require("../../assets/art/round_pushpin.png"),
  shopping_bags: require("../../assets/art/shopping_bags.png"),
  shopping_cart: require("../../assets/art/shopping_cart.png"),
  sparkles: require("../../assets/art/sparkles.png"),
  t_shirt: require("../../assets/art/t_shirt.png"),
  hot_beverage: require("../../assets/art/hot_beverage.png"),
  shallow_pan_of_food: require("../../assets/art/shallow_pan_of_food.png"),
  takeout_box: require("../../assets/art/takeout_box.png"),
  tropical_drink: require("../../assets/art/tropical_drink.png"),
  steaming_bowl: require("../../assets/art/steaming_bowl.png"),
  glass_of_milk: require("../../assets/art/glass_of_milk.png"),
  running_shoe: require("../../assets/art/running_shoe.png"),
  laptop: require("../../assets/art/laptop.png"),
  mobile_phone: require("../../assets/art/mobile_phone.png"),
  teddy_bear: require("../../assets/art/teddy_bear.png"),
  wrapped_gift: require("../../assets/art/wrapped_gift.png"),
  soccer_ball: require("../../assets/art/soccer_ball.png"),
  gem_stone: require("../../assets/art/gem_stone.png"),
  television: require("../../assets/art/television.png"),
  syringe: require("../../assets/art/syringe.png"),
  herb: require("../../assets/art/herb.png"),
  stethoscope: require("../../assets/art/stethoscope.png"),
  wheel: require("../../assets/art/wheel.png"),
  battery: require("../../assets/art/battery.png"),
  gear: require("../../assets/art/gear.png"),
  oil_drum: require("../../assets/art/oil_drum.png"),
  bicycle: require("../../assets/art/bicycle.png"),
  barber_pole: require("../../assets/art/barber_pole.png"),
  lotus: require("../../assets/art/lotus.png"),
  sewing_needle: require("../../assets/art/sewing_needle.png"),
  printer: require("../../assets/art/printer.png"),
  camera: require("../../assets/art/camera.png"),
  pizza: require("../../assets/art/pizza.png"),
  poultry_leg: require("../../assets/art/poultry_leg.png"),
  curry_rice: require("../../assets/art/curry_rice.png"),
  ice_cream: require("../../assets/art/ice_cream.png"),
  dress: require("../../assets/art/dress.png"),
  basket: require("../../assets/art/basket.png"),
  factory: require("../../assets/art/factory.png"),
  delivery_truck: require("../../assets/art/delivery_truck.png"),
  bread: require("../../assets/art/bread.png"),
} as const;

export type ArtName = keyof typeof ART;

export function picture(name: ArtName): ImageSourcePropType {
  return ART[name];
}

const TRADE: Record<string, ArtName> = {
  food: "hamburger",
  restaurant: "hamburger",
  bakery: "croissant",
  mart: "shopping_cart",
  grocery: "shopping_cart",
  pharmacy: "pill",
  clinic: "pill",
  retail: "shopping_bags",
  wholesale: "package",
  books: "books",
  salon: "lipstick",
  services: "hammer_and_wrench",
  service: "hammer_and_wrench",
  workshop: "hammer_and_wrench",
  hardware: "hammer_and_wrench",
  automotive: "automobile",
  petroleum: "fuel_pump",
  online: "shopping_bags",
  finance: "money_bag",
  general: "convenience_store",
};

/** A trade's picture; any trade not named gets the corner shop. */
export function tradePicture(type: string | null | undefined): ImageSourcePropType {
  return ART[TRADE[(type ?? "").toLowerCase()] ?? "convenience_store"];
}

const SHORTCUT: Record<string, ArtName> = {
  offers: "label",
  cheap: "coin",
  new: "sparkles",
  top: "glowing_star",
};

/** The aisle shortcuts' pictures — null for one this file does not know. */
export function shortcutPicture(key: string): ImageSourcePropType | null {
  const name = SHORTCUT[key];
  return name ? ART[name] : null;
}

/**
 * A SHOP CATEGORY'S PICTURE — the finer word inside a trade.
 *
 * "Lazmi ni retail main shirt e aye gi, food main burger": a trade is many
 * kinds of shop. So the category's own code is looked up first (the
 * platform's fixed list: `fast_food`, `cafe`, `footwear`…), then words in its
 * name — a shop category somebody named "Pizza Point" still gets the pizza —
 * and only then the trade's picture.
 */
const CATEGORY: Record<string, ArtName> = {
  restaurant: "shallow_pan_of_food",
  fast_food: "hamburger",
  cafe: "hot_beverage",
  bakery: "croissant",
  cloud_kitchen: "takeout_box",
  juice_corner: "tropical_drink",
  home_kitchen: "steaming_bowl",
  grocery: "shopping_cart",
  supermarket: "shopping_cart",
  general_store: "convenience_store",
  mini_mart: "basket",
  convenience_store: "convenience_store",
  dairy_shop: "glass_of_milk",
  garments: "t_shirt",
  footwear: "running_shoe",
  electronics: "laptop",
  mobile_accessories: "mobile_phone",
  cosmetics: "lipstick",
  toys: "teddy_bear",
  gifts: "wrapped_gift",
  sports: "soccer_ball",
  books_stationery: "books",
  hardware: "hammer_and_wrench",
  jewellery: "gem_stone",
  home_appliances: "television",
  medical_store: "pill",
  surgical: "syringe",
  homeopathic: "herb",
  clinic_pharmacy: "stethoscope",
  tyre_shop: "wheel",
  battery_shop: "battery",
  auto_parts: "gear",
  auto_workshop: "hammer_and_wrench",
  oil_change: "oil_drum",
  car_wash: "automobile",
  bike_workshop: "bicycle",
  petrol_pump: "fuel_pump",
  cng_station: "fuel_pump",
  diesel_station: "fuel_pump",
  lubricants_shop: "oil_drum",
  salon_beauty: "lipstick",
  barber: "barber_pole",
  spa: "lotus",
  mobile_repair: "mobile_phone",
  computer_repair: "laptop",
  tailor: "sewing_needle",
  laundry: "basket",
  printing: "printer",
  photography: "camera",
  clinic: "stethoscope",
  online_boutique: "dress",
  handmade: "wrapped_gift",
  electronics_online: "laptop",
  beauty_online: "lipstick",
  distributor: "delivery_truck",
  manufacturer: "factory",
  importer: "package",
  cloth_wholesale: "t_shirt",
  grocery_wholesale: "package",
  hardware_wholesale: "hammer_and_wrench",
  electronics_wholesale: "laptop",
  cosmetics_wholesale: "lipstick",
};

/** Words in a name, checked in order — the first that matches wins. */
const WORDS: Array<[RegExp, ArtName]> = [
  [/pizza/i, "pizza"],
  [/burger|fast\s*food|zinger/i, "hamburger"],
  [/biryani|pulao|rice/i, "curry_rice"],
  [/karahi|desi|pakistani|handi/i, "shallow_pan_of_food"],
  [/chicken|broast|bbq|tikka/i, "poultry_leg"],
  [/cafe|coffee|tea|chai/i, "hot_beverage"],
  [/juice|shake|smoothie/i, "tropical_drink"],
  [/ice\s*cream|kulfi|dessert/i, "ice_cream"],
  [/bak|cake|bread|sweet/i, "croissant"],
  [/milk|dairy/i, "glass_of_milk"],
  [/fruit|vegetable|sabzi/i, "broccoli"],
  [/shoe|footwear|chappal/i, "running_shoe"],
  [/mobile|phone/i, "mobile_phone"],
  [/laptop|computer|electronic/i, "laptop"],
  [/dress|boutique|fashion/i, "dress"],
  [/shirt|cloth|garment|apparel/i, "t_shirt"],
  [/pharma|medic|chemist/i, "pill"],
  // Not "store": "Retail Store" is not a grocery, and drew a cart.
  [/grocer|\bmart\b|supermarket|kiryana|karyana/i, "shopping_cart"],
];

export function categoryPicture(
  value: string | null | undefined,
  label: string | null | undefined,
  trade: string | null | undefined,
): ImageSourcePropType {
  const code = (value ?? "").toLowerCase();
  if (CATEGORY[code]) return ART[CATEGORY[code]];
  const text = `${label ?? ""} ${value ?? ""}`;
  for (const [re, name] of WORDS) if (re.test(text)) return ART[name];
  return tradePicture(trade);
}

/** Does the platform's category code have a picture of its own? */
export function knowsCategory(value: string): boolean {
  return value.toLowerCase() in CATEGORY;
}
