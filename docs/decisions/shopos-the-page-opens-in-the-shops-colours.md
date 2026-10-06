# The page opens in the shop's colours

**2026-10-06 · reported from a counter machine**

> "jb page refresh hota hai to pehle theme ka color show krta, phr wo krta jo
> save kia hota. Ye cache hojana chahye jb tk change na kry us device py."

## Why it flashed

The shop's colours live in its settings, and its settings are a request.
`useTenantTheme` ran its effect with the settings still `undefined`, read
that as "no colour chosen", and painted the house blue — then painted the
shop's own when the request landed. Every reload, for as long as the request
took.

Dark mode flashed for a different reason: the provider started every session
as "light" and switched in an effect, one paint later.

## Now

- `common/theme/rememberedTheme.ts` keeps the last colours this device was
  told, **with the shop's id** (`localStorage["shopos-theme"]`).
- `bootTheme()` runs in `main.tsx` ABOVE `render`: dark mode, and the
  remembered colours — but only for the shop whose own people are signed in
  on this device (`shopos-auth`, role `shop_owner` / `staff`). A second shop
  on the same machine, the platform console and a signed-out page all keep
  the house look.
- `useTenantTheme` leaves the page alone until it has an answer; then it
  applies the answer and remembers it. Leaving the shop's screens takes the
  colours off.
- `ThemeProvider` reads dark mode on its first render.

A colour changed on ANOTHER device shows once as the old one, then changes
and is remembered. That is the correct single flash: this device was told
nothing until then.

## Tests

`rememberedTheme.test.ts` (9), `useTenantTheme.test.tsx` (6). Checked in a
browser with the settings request held for three seconds: 0.7s into the
reload the page was already the shop's green with its coloured rail. 8
mutations, all caught.
