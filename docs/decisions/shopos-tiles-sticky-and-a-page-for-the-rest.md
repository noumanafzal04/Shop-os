# Tiles, a bar that sticks, and a page for the rest

**2026-09-07/08.** One sitting, six reports, all on the customer home and shop
pages. Recorded because four of them were caused by earlier decisions in this
same repo, and two were caused by my own detectors.

## The reports and what each turned out to be

| Reported | Actual cause |
|---|---|
| "Banner cutting on mobile" | artwork not 2:1; nothing validated shape at upload |
| "Shop detail py lag araha scroll krty" | `renderItem` inline → every row re-rendered on every scroll |
| "Tab category sbse top py q rkh" | the bar had been moved out of the list to stop a crash |
| "Rider side attractive ni hai / branding nahi" | rider board wore a plain `ScreenHeader` |
| "View all categories" | the tile grid rendered every trade and wrapped |
| "Icons images type" | glyphs were one colour by an earlier, still-valid decision |

## The banner

The app draws 2:1 and fills with `cover`, so anything else loses its edges.
`image` was validated for type and size, never for shape. The refusal now names
the size sent, the size wanted, and **which edges** disappear — my first version
of that sentence said "top and bottom" when a too-wide file loses left and
right, which is worse than no warning: it sends somebody to move text that was
already right.

The form's hint had also blamed "narrow phones". The card is the screen width
less 32 points and half that in height — 2:1 at every width. The crop never came
from the screen.

## The sticky bar, reversed

After two Fabric mount crashes the bar became one element outside the list,
permanently above it. Safe, and reported as wrong.

It is two elements again — a row in the list and an absolutely positioned copy.
**Two elements is not what crashed; re-parenting one element was.**
`stickyHeaderIndices` and `Animated.event` with the native driver stay banned
for that reason, and the listener is plain JS that flips a ref before touching
state.

The threshold is the **header's measured height**. Reading `layout.y` off the
cats row gives 0 — FlatList wraps every row in a cell container — so the
condition would have been `offset >= 0`, or with a zero guard, a bar that never
appeared and nothing to say why.

And `jumps` is rebuilt with the offset rather than patched: unshifting a row in
front of a map of row numbers leaves every chip landing on the last product of
the previous category.

## The lag was not the bar

`renderItem` was an arrow function in the component body, and `section` changes
while a finger is moving. `removeClippedSubviews` is off here (it crashed
twice), so nothing unmounts — every category boundary crossed was rebuilding the
whole menu. `ProductRow` is memoised now.

## Two guards that were missing, and three that were wrong

**Missing:** nothing checked that a mobile screen can be OPENED (28 screens, no
guard), and this screen had four test files mentioning it and none that rendered
it — on the screen that has crashed on a device twice.

**Wrong, mine:**
- `darkModeDebt` failed on the docblock of the style rewritten to obey it. Fourth
  guard here to fire on its own documentation. `codeOnly` is now shared and
  position-preserving.
- That change broke `accountPage`, which bounded checks with `slice(0, 1200)` —
  a window measured in characters.
- The reachability detector was wrong three times before it was right: tab
  screens, menu rows naming a route in a data array, and a screen that IS the
  stack for a non-customer session.
- The Jest SVG mock was a hand-written list missing `Ellipse`, which surfaced as
  "Element type is invalid" in an unrelated test.

## Illustrated tiles

Stock vector files were the reference and are the wrong medium: their free
licences forbid redistribution in an app, and thirty-six image files cannot
follow the theme. Drawn from `react-native-svg` primitives instead — composed
shapes, not traced path data, because path data cannot be reviewed by reading
it.

`tradeIcon`'s one-colour rule still holds; the discipline moved below the tiles.
At the top of the funnel, colour is what finds "pharmacy" without reading.
