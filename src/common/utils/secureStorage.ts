import * as Keychain from "react-native-keychain";

/**
 * Tokens live in the OS-encrypted store (iOS Keychain / Android Keystore) —
 * never in AsyncStorage or plain files.
 */
export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * An ADDRESS, not a brand — see `common/brand.ts`.
 *
 * Its own namespace, and not the customer app's `shopos.auth`. Two apps on one
 * phone is the normal case here: a shopkeeper who also orders lunch. Sharing a
 * Keychain service would mean signing into one silently replaces the session
 * of the other, and signing out of either logs both out.
 *
 * This spelling is fixed for ever. Renaming it does not move the tokens; it
 * points at an empty entry and signs every user out with no error anywhere.
 */
const SERVICE = "cartze.partner.auth";

export const secureStorage = {
  async saveTokens(tokens: StoredTokens): Promise<void> {
    await Keychain.setGenericPassword("partner", JSON.stringify(tokens), {
      service: SERVICE,
    });
  },

  async getTokens(): Promise<StoredTokens | null> {
    try {
      const result = await Keychain.getGenericPassword({ service: SERVICE });
      if (!result) return null;
      return JSON.parse(result.password) as StoredTokens;
    } catch {
      // Corrupted entry or keychain unavailable → treat as logged out.
      return null;
    }
  },

  async clearTokens(): Promise<void> {
    await Keychain.resetGenericPassword({ service: SERVICE });
  },
};
