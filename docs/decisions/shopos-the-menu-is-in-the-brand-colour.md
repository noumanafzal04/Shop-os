# The menu is in the brand colour unless a shop says otherwise

**2026-10-07 · the owner's word**

> Default sidebar and theme color primary rakhna hai. Admin side par sidebar
> color primary — admin ko humne appearance ka option nahi dia. Demo create
> ho to sidebar primary. Appearance canvas mein default sidebar primary,
> start mein; second mein white, aur baki.

## Now

| Where | Sidebar |
|---|---|
| A shop that has never opened Appearance | Primary |
| A demo made from the landing page | Primary (it stores nothing — it is the default) |
| The platform console | Primary, always — it has no Appearance to open |
| A shop that saved its Appearance | whatever it saved; a stored choice is not a default |

Appearance → Sidebar offers **Primary · White · Tinted · Dark**, in that
order, on one row (four in a grid of three left "Dark" alone on a line).

## One default, not six

"What the sidebar is by default" was written in five panel files and one on
the server, each saying `light`. It is `DEFAULT_SIDEBAR` in
`common/theme/tenantTheme.ts` now, with `SIDEBAR_CHOICES` beside it, and
`ShopSettings::defaults()` on the server.

`defaultSidebar.test.ts` holds the constant, then reads the four files that
used to keep a default of their own and the server's file, and fails if any
of them falls back to white. The platform console is drawn entirely from the
rail's own fallback, which is why that file is on the list.

## What a shop will notice

A shop that saved Appearance once — even only to change its colour — has
`light` stored with it, because the canvas saves all three together. Those
shops stay white until they press Primary. Nothing was rewritten for them.
