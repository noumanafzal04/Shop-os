/**
 * Auth store lifecycle: boot → authenticated → guest, with tokens
 * persisted to (mock) Keychain.
 */
import { useAuthStore } from '../src/stores/authStore';
import { secureStorage } from '../src/common/utils/secureStorage';
import type { User } from '../src/modules/auth/types';

const fakeUser: User = {
  id: 'u1',
  name: 'Owner',
  email: 'o@t.com',
  phone: null,
  role: 'shop_owner',
  status: 'active',
  permissions: [],
  email_verified: true,
  phone_verified: false,
  last_login_at: null,
  tenant: null,
  created_at: '2026-01-01T00:00:00Z',
};

describe('authStore', () => {
  beforeEach(async () => {
    await secureStorage.clearTokens();
    useAuthStore.setState({
      status: 'booting',
      user: null,
      accessToken: null,
      refreshToken: null,
    });
  });

  test('setAuth stores tokens securely and flips to authenticated', async () => {
    await useAuthStore.getState().setAuth(fakeUser, 'acc-1', 'ref-1');

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().accessToken).toBe('acc-1');

    const stored = await secureStorage.getTokens();
    expect(stored).toEqual({ accessToken: 'acc-1', refreshToken: 'ref-1' });
  });

  test('clear wipes memory and keychain', async () => {
    await useAuthStore.getState().setAuth(fakeUser, 'acc-1', 'ref-1');
    await useAuthStore.getState().clear();

    expect(useAuthStore.getState().status).toBe('guest');
    expect(useAuthStore.getState().user).toBeNull();
    expect(await secureStorage.getTokens()).toBeNull();
  });

  test('hydrateTokens restores a persisted session into memory', async () => {
    await secureStorage.saveTokens({ accessToken: 'acc-2', refreshToken: 'ref-2' });

    const found = await useAuthStore.getState().hydrateTokens();

    expect(found).toBe(true);
    expect(useAuthStore.getState().accessToken).toBe('acc-2');
  });

  test('hydrateTokens with empty keychain reports false', async () => {
    expect(await useAuthStore.getState().hydrateTokens()).toBe(false);
  });

  test('hasPermission: owner has all, staff only assigned', () => {
    useAuthStore.getState().setUser({ ...fakeUser, role: 'shop_owner' });
    expect(useAuthStore.getState().hasPermission('sales.manage')).toBe(true);

    useAuthStore.getState().setUser({
      ...fakeUser,
      role: 'staff',
      permissions: ['products.manage'],
    });
    expect(useAuthStore.getState().hasPermission('products.manage')).toBe(true);
    expect(useAuthStore.getState().hasPermission('sales.manage')).toBe(false);
  });
});
