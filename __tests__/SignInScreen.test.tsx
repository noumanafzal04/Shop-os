/**
 * SignInScreen renders inside the query provider with all baseline UX
 * components (SafeScreen, KeyboardScreen, inputs, tap-guarded button).
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SignInScreen } from '../src/modules/auth/screens/SignInScreen';

test('SignInScreen renders with inputs and button', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  let tree!: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <QueryClientProvider client={client}>
        <NavigationContainer>
          <SignInScreen />
        </NavigationContainer>
      </QueryClientProvider>,
    );
  });

  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('ShopOS');
  expect(json).toContain('Email or phone');
  expect(json).toContain('Password');
  expect(json).toContain('Sign in');
});
