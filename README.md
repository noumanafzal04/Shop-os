# `@cartze/core`

What the customer app and CartZe Partner both stand on: design tokens, the
UI primitives, the HTTP client and the keychain-backed prefs.

## How it is consumed

By **alias**, not by `npm install`:

| where | how |
|---|---|
| Metro | `watchFolders` + `extraNodeModules["@cartze/core"]` |
| Jest | `moduleNameMapper` |
| TypeScript | `compilerOptions.paths` |

Three places, and they must agree — a mapping that exists in two of them
compiles, bundles, and fails in the third at the worst moment.

## No node_modules of its own

`react` and `react-native` are **peer** dependencies and resolve from
whichever app is importing. Two copies of React in one bundle breaks hooks
in ways that read as random re-render bugs.

## Why it is filled a slice at a time

`mobile/` has 838 passing tests and a released APK, and 37 of those test
files read shared code BY PATH. Moving everything at once would rewrite
107 files in one commit with nothing green in between.

So: one slice, all tests green, commit. The first slice is the theme
tokens, chosen because nothing reads them by file path — which made it the
one place the alias pipeline could be proved end to end without also
rewriting a guard.

`mobile/__tests__/sharedLayerIsShared.test.ts` is what makes this safe: it
already proves nothing in the shared layer reaches back into an app.
