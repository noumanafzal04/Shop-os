import * as Keychain from "react-native-keychain";

/**
 * Tokens live in the OS-encrypted store (iOS Keychain / Android Keystore) —
 * never in AsyncStorage or plain files.
 */
export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

// An ADDRESS, not a brand. This names the Keychain entry holding the session,
// so renaming it does not move the tokens — it points at an empty entry and
// signs every user out silently. It keeps this spelling whatever the product
// is called; see `src/common/brand.ts`.
const SERVICE = "shopos.auth";

export const secureStorage = {
  async saveTokens(tokens: StoredTokens): Promise<void> {
    await Keychain.setGenericPassword("shopos", JSON.stringify(tokens), {
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
