/**
 * When "Set new password" may be pressed — the server's own rules, said
 * before the round trip: a six-digit code, eight characters or more, typed
 * the same twice (`ResetPasswordRequest`: digits:6, min:8, confirmed).
 */
export function resetReady(f: { code: string; password: string; again: string }): boolean {
  return /^\d{6}$/.test(f.code.trim()) && f.password.length >= 8 && f.password === f.again;
}
