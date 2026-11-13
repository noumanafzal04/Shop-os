# UI brief — the customer app (2026-11-13)

Research behind the v2 redesign: how the market leaders (foodpanda, Uber Eats, DoorDash, Deliveroo, Talabat, Careem, Swiggy, Zomato, Daraz) build each screen, turned into rules for this app. Sources are listed at the end; where a source could not be read (HTTP 403) or does not exist publicly (Delivery Hero's design system, foodpanda's colour rules) the point is marked as observation or recommendation.

Implemented so far: the palette (core `palette.ts` — `tealBrand`, `dealOrange`, `tealGray`) and the type, spacing and radius scales (core `tokens.ts`). The screens follow this brief one by one.

---

# True Serve customer app: UI brief

Source notes: I found no public Delivery Hero "Kepler" system and no foodpanda colour rulebook. Medium, the Deliveroo design site and the Delivery Hero tech blog blocked fetching, so those points rely on search excerpts. The hard numbers come from source code: Uber Base Web [13] and Zomato Sushi [14]. **Rule** marks my recommendation.

## 1. Screens

**Home**
- foodpanda's "bento" home puts big service tiles first [10]. Daraz puts categories under search [28]. Users look for reorders on the home screen [1][2].
- **Rule:** teal header (address "Deliver to ▾", cart icon) with a white 48-tall search pill → 2×2 shop-type tiles → "Order again" row → offer carousel (16:7, radius 16) → chip filters → shop cards.
- **Shop card:** 16:9 image at radius 16; name 16/600; "★4.5 (1.2k) · 25–35 min · Rs 99 delivery"; offer badge top-left. Closed shops: image at 40% plus "Opens 11:00".

**Shop page**
- Uber: hero carousel, logo, rating, distance, address chevron [4]. Deliveroo's system says menu tab labels are merchant-written, so tabs must take long labels [12]. Swiggy lets users jump between categories and to the cart without scrolling [7].
- **Rule:** 220 hero, then an info block (rating, ETA, fee, minimum order, Delivery|Pickup).
  - Once the hero scrolls away, show a white sticky header (back, name, search) and a scrolling category tab bar.
  - Tabs sync both ways: a tap scrolls to the section; scrolling updates and centres the active tab.
- **Menu rows, not cards:** name 15/600, description 13 grey (2 lines), price, 96×96 image on the right (radius 12) with a "+" overlapping it. Use cards only for the "Popular" carousel. No image means a text-only row.
- **Sold out:** the row stays in place at 40% opacity, shows "Sold out" instead of the price, and has no "+".

**Item detail**
- Uber uses a full-screen customiser with "Required" group headers [4]. Apple: full screen for complex flows, a sheet with a grabber for scoped tasks [15]. Baymard: options go undescribed and cannot be edited from the cart [1][2].
- **Rule:** an item with no options adds straight from its row. An item with options opens a sheet at about 92% height:
  - a collapsing 16:9 image
  - required groups first, with a "Required" badge that turns into a green ✓, plus "Choose 1" or "Choose up to 3"
  - 52-tall radio or checkbox rows with "+Rs 150" on the right
  - a sticky footer with a stepper and "Add to cart · Rs 1,450", which updates live
- Never a dead button: a tap with a group unmet scrolls to it, shows red helper text and plays the error haptic. Cart lines get "Edit".

**Cart**
- Uber: floating "View cart" with a running total [3]; then lines with steppers, "Add items", and an upsell screen with "No thanks" [4]. Deliveroo nudges basket size with progress bars [9].
- **Rule:** one cart per shop: lines (options summary, Edit, stepper) → "Add more items" → a "Goes well with" carousel inside the cart, not an extra screen → "Add Rs 150 for free delivery" bar → note to shop. Sticky "Checkout · Rs 2,340".

**Checkout**
- Uber: address → instructions → schedule → summary → payment, with the total on the floating button and a distinct colour for "Place order" [3][4]. Swiggy puts one-touch payment, including cash on delivery, first [7]. Baymard: put the promo field behind a link [23]. DoorDash explains fees behind an "i" [24]. Careem turns the button into a 5-second cancel countdown after placing [8].
- **Rule, in this order:** Delivery|Pickup segmented control → address card with mini-map and Change (Pickup: shop address and Directions) → ASAP/Schedule → cash on delivery preselected → "Apply a coupon ›" row (sheet; when applied, shows the code, the saving and Remove) → bill → "Place order · Rs 2,340" → 5-second undo.
- **Bill, top to bottom:** Subtotal; Discount (−, green); Delivery fee (struck through when free); Service fee; Tax; Total 18/700. All from the server quote; during a re-quote only the figures shimmer.

**Tracking**
- Uber: a 5-step bar with a live map on the courier steps [3]; "Latest arrival by" and the courier's name [6]; delay explanations and courier contact before pickup [5].
- **Rule:** map on the top 50% (route in bright teal). Sheet with detents at 45% and 90%:
  - ETA "12–18 min" 28/700 and "Arriving by 8:40 PM"
  - 4 segments: Confirmed, Preparing, On the way, Delivered
  - a rider card: photo, name, plate, round Call and Chat buttons (44)
  - a delay banner with the reason
- Pickup orders show a large pickup code instead of a rider.
- **Rider mode:** Delivery Hero went map-first, with floating layers and a status/earnings bubble [25]. **Rule:** job cards lead with the payout (20/700), then distance and route, then a 52-tall Accept. Each delivery step has one 56-tall action.

**Orders history**
- Baymard: histories are too sparse to recognise past orders [2].
- **Rule:** active orders pinned at the top. Past rows: logo, shop, date, "2× Zinger, 1× Fries", total, status pill, Reorder button (36).

**Search**
- Swiggy treats autocomplete as latency-critical, since every keystroke is a query [26]. Built for Mars treats zero-result searches as a failure point [27].
- **Rule:**
  - Before typing: recents (✕ and Clear all), popular searches as chips.
  - While typing: 300 ms debounce, suggestions grouped Shops / Items, match in bold.
  - Results: "Shops | Items" tabs.
  - Zero results: never blank; suggest nearby shops and categories.

**Filters and sort**
- **Rule:** chip row: Sort ▾, Offers, Free delivery, 4.0+, Under 30 min, Pickup.
  - Sort opens a sheet of radio rows that applies on tap.
  - Filters opens a sheet of chip groups with a sticky "Reset" (text button) and "Show 24 shops" (live count).
  - A count badge sits on the Filters chip.

**Loading, empty and error**
- NN/g: under 1 s show nothing; 1–10 s use a skeleton for pages and a spinner only for one module; over 10 s use a progress bar. Skeletons must mirror the real layout [18]. Wolt's BlurHash sends a 20–30 character string in the API that renders a blurred colour preview, not grey boxes [19].
- **Rule:** three distinct states. Skeleton for loading. Empty: illustration, one line, one action. Failed: "Couldn't load shops" with "Try again", keeping cached content visible under an offline banner.

## 2. Feeling fast
- **Optimistic cart:** the stepper, badge and bar update instantly. TanStack pattern: cancel → snapshot → write → roll back on error → invalidate when settled [20]. Server-priced figures shimmer until the quote returns.
- **Sticky CTA:** 52 tall, 16 margins, above the safe area, white bar with a top shadow, "Label · Price".
- **Pull-to-refresh:** Home, Orders, search results, rider job board. Not in sheets or checkout.
- **Infinite scroll:** the threshold is measured in screen-heights [21]. Use 1.0–1.5, pages of 20, two skeleton cards in the footer, and prefetch the next page's images.
- **Images:** 2× thumbnails; fade in over the BlurHash in 150 ms; prefetch a shop's hero on card press-in.
- **Haptics** (consistent, sparing, optional [17]):
  - selection: chip, tab, stepper
  - light impact: add to cart
  - success: order placed
  - error: order failed
- **Sheets** [15]: grabber, swipe to dismiss, medium/large detents, one sheet at a time, confirm before discarding chosen options. Scrim 40%, top radius 20.
- **Motion:** 150–250 ms (Base Web's scale runs 100–400 [13]). On add to cart, the badge bumps 1→1.15→1. Honour Reduce Motion [16].
- **Tap targets** at least 44 pt [16]. Give the 32-pt "+" extra touch area (hitSlop).

## 3. Tokens
- **Reference points:**
  - Base Web: 4-px sizes, radii 2/4/8/12/16, buttons radius 8 or pill and about 36/48/56 tall, shadows from 0 1 4 to 0 8 24 at 16% [13].
  - Sushi: text 10–28 at 1.2 line height, corner 8, buttons 25/32/48, ADD stepper 90×32 [14].
  - Apple: body 17, minimum 11 [16].
- **Type** (one family; weights 400–700; tabular numbers for money):

  | Token | Size / line height | Weight | Use |
  |---|---|---|---|
  | display | 28/34 | 700 | ETA |
  | h1 | 22/28 | 700 | screen titles |
  | h2 | 18/24 | 700 | sections |
  | title | 16/22 | 600 | names |
  | body | 15/22 | 400 | general text |
  | body-sm | 13/18 | 400 | descriptions |
  | caption | 12/16 | 500 | small labels |
  | micro | 11/14 | 600 | badges; the floor |
  | price | 15/20 | 600 | prices |
  | total | 18/24 | 700 | bill total |
  | button | 16/20 (L) or 14/18 (M) | 600 | button labels |

- **Spacing:** 2, 4, 8, 12, 16, 20, 24, 32, 40. Gutter 16, card padding 12, card gap 12, section gap 24.
- **Radii:** badge 6, button and input 12, thumbnail 12, card and banner 16, sheet 20, pill for chips, steppers and "+".
- **Elevation:**
  - e0: none, the default. Use the grey background or a border instead.
  - e1: 0 1 4 at 8%, cards over photos or the map.
  - e2: 0 −2 12 at 8%, sticky bars.
  - e3: 0 8 24 at 16%, sheets.
- **Buttons:**
  - Heights: L 52 (full-width CTA), M 44, S 36, XS 32.
  - Primary = filled teal; secondary = tonal (mist tint, teal text); tertiary = 1.5 teal outline; text = teal at weight 600.
  - One filled primary per screen. While loading, a spinner replaces the label at a fixed width.
- **Chips:** 36 tall, pill, label 14/500. Unselected: white with a #DDE3E6 border. Selected: teal fill, white text and ✓.
- **Prices:** neutral text, never brand colour. "Rs 1,450" with no decimals; the currency comes from the shop. Discounts: new price, struck-through old price, orange "−20%" badge.
- **Icons:** one outline set on a 24 grid with a 1.75–2 stroke; filled only for the active nav item; sizes 16/20/24.

## 4. Colour (contrast I computed; target 4.5:1 for text [16])
- **How leaders use colour:** Uber Eats keeps the UI black and white and saves its green for "Place order" [3]. foodpanda pushes pink across its visuals as its signature, chosen against orange competitors [10][11]. In its app (my observation), pink fills the CTAs, header and deal badges, and the rest is white or grey. So: one brand colour on a few high-value elements, greys, and one promo accent.
- **Deep teal #03444A (10.9:1):** all filled primary buttons, the Home header, selected chips, the 2-px active tab underline, the active nav item, links. Not on prices or body text.
- **Burnt orange #C4421A (5.1:1):** deals only: offer badges ("20% OFF", "Free delivery"), banner CTAs, the coupon icon, the rider "New job" alert. Never on primary buttons.
- **Orange #FF924D (2.2:1):** tints only (the offer-banner background #FFF3EC), rating stars beside the number, illustrations. Text on that tint uses #C4421A (4.7:1).
- **Bright teal #00A8A8 (2.9:1):** the tracking route, progress fill, spinners, illustrations. Never text.
- **Mist #9AD3DA:** tonal button backgrounds (teal text 6.6:1); a #EAF6F7 tint for selected options and info banners (9.9:1).
- **Neutrals:**

  | Role | Hex | Note |
  |---|---|---|
  | Screen | #FFFFFF | |
  | Grouped background | #F5F6F7 | |
  | Divider and skeleton | #ECEFF1 | |
  | Border | #DDE3E6 | decorative only |
  | Text | #1A1F23 | |
  | Secondary text | #5F6B73 | 5.5:1 |
  | Disabled | #8A949B | |

- **Semantic colours:** success #157F3C (5.1:1: delivered, savings), warning #B54708 on #FFFAEB (delays), error #B42318 on #FEF3F2 (failures). Always pair colour with an icon [16]. Warning always gets ⚠ so it isn't read as a deal.
- **Dark mode:** background #121212, surfaces #1E1E1E/#262626, desaturated brand colours [22]. Primary fill becomes mist with a #03444A label. Burnt orange falls to 3.7:1, so orange text switches to #FF924D (8.5:1). Ship light mode first.

## 5. Top 10 to copy
1. Sticky CTAs with a live price ("View cart · 3 · Rs 2,340") [3].
2. A collapsing shop hero with sticky, scroll-synced category tabs [4][12].
3. A one-tap "+" that becomes a stepper; the options sheet only when needed, with required groups first [4].
4. Layout-true skeletons plus BlurHash; no full-screen spinners [18][19].
5. A Home with a teal address header, search pill, shop-type tiles and "Order again" [10][1].
6. A one-page checkout: cash on delivery preselected, coupon behind a row, fixed bill order [3][7][23].
7. Tracking with a big ETA, "arriving by", a 4-step bar, a rider card and delay reasons [3][5][6].
8. A 5-second undo after Place order [8].
9. One token set used everywhere [13][14].
10. Filter chips with a live count; haptics on add and success [17].

## Sources
[1] https://baymard.com/blog/food-delivery-takeout-launch
[2] https://baymard.com/blog/food-delivery-and-takeout-ux-benchmark-2026
[3] https://ixd.prattsi.org/2021/02/design-critique-ubereats-ios-app/
[4] https://revyl-landing.pages.dev/atlas/uber/flows/home-uber-tab-rides-to-checkout-eats/
[5] https://www.uber.com/tw/en/newsroom/eatsredesign/
[6] https://www.restaurantdive.com/news/uber-eats-boosts-delivery-tracker-transparency-with-colorful-animations/552513/
[7] https://www.prosus.com/news-insights/2022/designing-the-swiggy-app-to-be-truly-accessible-part-1
[8] https://builtformars.com/company/careem
[9] https://builtformars.com/company/deliveroo
[10] https://marketech-apac.com/foodpanda-rolls-out-new-brand-identity-across-asia/
[11] https://www.marketing-interactive.com/foodpanda-undergoes-global-rebrand-from-orange-to-pink
[12] https://design.deliveroo.net/components/pds/bars
[13] https://github.com/uber/baseweb (src/themes/shared/*.ts, src/button/styled-components.ts)
[14] https://github.com/Zomato/compose-sushi (foundation/Dimen.kt, button/SushiButtonDefaults.kt, stepper/StepperDefaults.kt)
[15] https://developer.apple.com/design/human-interface-guidelines/sheets
[16] https://developer.apple.com/design/human-interface-guidelines/accessibility
[17] https://developer.apple.com/design/human-interface-guidelines/playing-haptics
[18] https://www.nngroup.com/articles/skeleton-screens/
[19] https://careers.wolt.com/en/blog/tech/how-we-came-to-create-a-new-image-placeholder-algorithm-blurhash
[20] https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates
[21] https://reactnative.dev/docs/flatlist#onendreachedthreshold
[22] https://m2.material.io/design/color/dark-theme
[23] https://baymard.com/blog/grocery-ecommerce-benchmark
[24] https://help.doordash.com/en-us/consumers/article/what-fees-do-i-pay
[25] https://tech.deliveryhero.com/from-streets-to-screens-redesigning-the-rider-app
[26] https://infoq.com/news/2026/05/swiggy-autocomplete-rt-ranking
[27] https://builtformars.com/company/uber
[28] https://techlekh.com/new-daraz-nepal-app-website
