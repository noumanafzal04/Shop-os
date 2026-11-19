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
  shopping_bags: require("../../assets/art/shopping_bags.png"),
  shopping_cart: require("../../assets/art/shopping_cart.png"),
  sparkles: require("../../assets/art/sparkles.png"),
  t_shirt: require("../../assets/art/t_shirt.png"),
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
  retail: "t_shirt",
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
