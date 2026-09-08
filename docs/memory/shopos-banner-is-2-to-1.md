---
name: shopos-banner-is-2-to-1
description: "banners are 1200x600 (2:1) and refused otherwise; a too-wide file loses LEFT and RIGHT, not top and bottom"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-09-08T13:51:35.662Z
---

Home banners are **2:1** — `PromoCarousel` sets the card to screen width less
32pt and the height to half, so the ratio is the same on EVERY phone. Filled
with `resizeMode="cover"`. `BannerRequest::checkShape()` refuses anything
outside a 4% band and names the actual size; the panel pre-checks with
`bannerShape.ts` before uploading.

**Why:** reported as "banner cutting on mobile, not full banner showing" against
artwork made at 1200×480 — the size the admin form itself used to ask for.
Nothing validated shape, only type and size.

**How to apply:** `cover` matches the axis needing most magnification and spills
the other, so a **too-WIDE** file is scaled to the card's HEIGHT and loses
**left and right** (1200×480 loses ~20% of its width, a tenth each side). My
first warning said "top and bottom" — a warning naming the wrong axis is worse
than none. Both the PHP and the TS copies are tested on the axis.

The form's old hint blamed "narrow phones"; the crop never came from the screen.
Also note `image` max is **2 MB** on both sides because PHP's
`upload_max_filesize` is 2M — a bigger rule produces "The image failed to
upload" with no cause.

See [[shopos-cartze-brand]], [[shopos-price-and-card]].
