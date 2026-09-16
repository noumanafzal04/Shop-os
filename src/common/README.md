# `common/` — the shared half, temporarily duplicated

**Empty on purpose.** Nothing goes in here by hand.

Phase 0 lifts these out of `mobile/src/` into a package both apps import:

| from `mobile/src/` | what |
|---|---|
| `common/api/` | axios client, single-flight refresh, retry/backoff, react-query |
| `common/ui/` | SafeScreen, ScreenHeader, HeaderButton, SmartImage, EmptyState, LoadFailed, Skeleton, Price, Touchable, toast, confirm, icons |
| `common/hooks/` | useDebouncedValue, usePullToRefresh |
| `common/utils/` | keychain-backed prefs, secure storage |
| `theme/` | tokens, ThemeProvider, useColors |

Measured: **~6,800 lines** of the customer app's ~26,000 are shared code,
and another ~1,600 of navigation scaffolding is the same shape.

## Why extraction and not a copy

A copy means every shared fix is made twice. This codebase already paid
for that once: the location-permission prompt existed in two files, so one
bug — Android 12 granting COARSE while FINE is requested — lived in both,
and only one copy was ever fixed.

## Why it is not done yet

`mobile/` has 830 passing tests and a released APK. The extraction is its
own step, with those tests green before and after, and it happens before
any Partner screen is written — not during.
