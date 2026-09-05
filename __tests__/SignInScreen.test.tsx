/**
 * SignInScreen renders inside the query provider with all baseline UX
 * components (SafeScreen, KeyboardScreen, inputs, tap-guarded button).
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SignInScreen } from '../src/modules/auth/screens/SignInScreen';
import { ThemeProvider } from '../src/theme';
import { BRAND } from '../src/common/brand';

test('SignInScreen renders with inputs and button', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  let tree!: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider>
        <QueryClientProvider client={client}>
          {/* The screen reads the live palette now, so it needs the provider
              the app mounts — the same one that used to be mounted nowhere. */}
          <ThemeProvider>
            <NavigationContainer>
              <SignInScreen />
            </NavigationContainer>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
  });

  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain(BRAND.name);
  expect(json).toContain('Email or phone');
  expect(json).toContain('Password');
  expect(json).toContain('Sign in');
});
