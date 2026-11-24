import type { ImageSourcePropType } from "react-native";

/**
 * 3D PICTURES FOR EMPTY SCREENS — CC0 (3dicons, `assets/art3d/LICENSE.md`).
 *
 * "Pehle waly emoji achy ni lg rahy": an empty screen led with a grey line
 * icon on a disc. A 3D bag for no orders, a heart for no favourites, a pin for
 * no addresses reads warmer and says WHICH nothing it is at a glance — in
 * both apps, from one place.
 */
export const ART3D = {
  bag: require("../assets/art3d/bag.png"),
  heart: require("../assets/art3d/heart.png"),
  pin: require("../assets/art3d/map_pin.png"),
  chat: require("../assets/art3d/chat_bubble.png"),
  wallet: require("../assets/art3d/wallet.png"),
  moneyBag: require("../assets/art3d/money_bag.png"),
} satisfies Record<string, ImageSourcePropType>;

export type Art3dName = keyof typeof ART3D;
