---
name: shopos-sr-only-widened-page
description: FIXED — an sr-only span in a <th> pushed the page 84px sideways at 390px; position:absolute escapes a scroll container without a positioned ancestor
metadata:
  type: project
---

`<th><span className="sr-only">Actions</span></th>` widened the whole page by
**84px on a 390px phone**.

`sr-only` is `position: absolute`. With no positioned ancestor, its containing
block is the page itself — which puts it **outside the scroll container's
clipping chain**. The table lays out 477px wide inside a 356px scroller, the
span sits at x=474, and one invisible pixel of helper text scrolls the document.

Fix: `relative` on the `<th>`.

**Why:** it is invisible by construction and it is *added by doing the right
thing* — the span exists to give a headerless column an accessible name.

**How to apply:** an absolutely-positioned child inside anything that scrolls
(`overflow-x-auto`) needs a positioned ancestor inside that scroller, or it
escapes the clip. Applies to `sr-only`, tooltips, badges, popovers.

**The guard already existed and works:** e2e `rules.ts`'s sideways-scroll rule,
run by `chrome.spec.ts` on the `phone` project. Proven by putting the bug back
and watching `[phone] expenses` fail, then pass. See [[shopos-screen-testing]] —
jsdom has no layout engine and could never see this.
