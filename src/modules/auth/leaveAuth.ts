/**
 * OUT OF THE SIGN-IN SCREENS — all of them, back to where the person was.
 *
 * Sign-up links to sign-in and sign-in to sign-up, so the stack can hold both.
 * Signing in used to go back ONE screen: from sign-in opened off sign-up, that
 * landed a signed-in customer on the "Create your account" form they no longer
 * needed. This pops every auth screen on top of the stack, and only those —
 * a checkout underneath stays where it was.
 */
type Nav = {
  canGoBack: () => boolean;
  goBack: () => void;
  getState?: () => { routes: Array<{ name: string }> } | undefined;
  pop?: (count?: number) => void;
};

export const AUTH_ROUTES = new Set(["SignIn", "SignUp"]);

export function authScreensOnTop(routes: Array<{ name: string }>): number {
  let n = 0;
  for (let i = routes.length - 1; i >= 0 && AUTH_ROUTES.has(routes[i].name); i--) n++;
  return n;
}

export function leaveAuth(navigation: Nav): void {
  if (!navigation.canGoBack()) return;
  const routes = navigation.getState?.()?.routes;
  const n = routes ? authScreensOnTop(routes) : 1;
  if (n > 1 && navigation.pop) {
    navigation.pop(n);
    return;
  }
  navigation.goBack();
}

/**
 * Sign-in ⇄ sign-up SWAP places; they do not stack.
 *
 * Each linked to the other with `navigate`, which pushed — so changing your
 * mind twice left three auth screens on the stack, and Back walked through
 * all of them, the last one a sign-in form for somebody already signed in.
 */
export function switchAuth(
  navigation: { replace?: (name: string) => void; navigate: (name: string) => void },
  to: "SignIn" | "SignUp",
): void {
  if (navigation.replace) navigation.replace(to);
  else navigation.navigate(to);
}
