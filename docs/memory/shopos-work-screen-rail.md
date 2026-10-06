---
name: shopos-work-screen-rail
description: Floor / tab / kitchen keep an icon-only rail (WorkScreenLayout); POS stays without one; tapping a group on a collapsed rail now opens it (was a dead button on tablets)
metadata:
  type: project
---

**2026-10-06, user:** "kot or dine in screen kam sy kam chota sidebar to show hona chahye".

`panel/src/layout/WorkScreenLayout.tsx` wraps `/tenant/dine-in`, `/tenant/dine-in/tickets/:id`, `/tenant/kitchen`: `SidebarProvider iconsOnly` + `AppSidebar` + page with `lg:pl-[90px]`. The rail is never pinned wide there — hover or `RailMenuButton` opens it OVER the page (the page must not reflow). Below `lg` it is the usual drawer.

**POS is deliberately NOT in it** (user likes the till full-screen: [[shopos-pos-ux]]).

**Dead button found:** on a collapsed rail a group's click toggled a submenu that is only drawn with labels — invisible to a mouse (hover had widened it), dead on a tablet. Now `holdPeek()` opens the rail; the next outside tap or a navigation releases it (`isPeekHeld`). `tabletChrome.test.ts` holds both.

Related: [[shopos-tablet-chrome]], [[shopos-full-screen-pinned-room]]
