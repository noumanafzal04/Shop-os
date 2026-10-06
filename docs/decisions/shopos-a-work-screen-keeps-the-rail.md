# A work screen keeps the rail

**2026-10-06 · "kot or dine in screen kam se kam chota sidebar to show hona
chahye"**

The floor, a tab and the kitchen board run outside the app shell so the work
gets the screen. The only way off any of them was one "‹ Dashboard" link.

`WorkScreenLayout` wraps those three routes: the rail and nothing else of the
shell — icons only, ninety pixels, **never pinned wide**. Hovering it, or the
menu button in the screen's own header, opens it OVER the page; the page does
not move, because a kitchen board that reflows when a sleeve brushes the edge
is a board nobody can read. Below `lg` it is the same drawer as everywhere.

The till is not in it, on purpose.

## A dead button this found

On a rail of icons, a group (Expense Manager, Catalog…) toggled a submenu
that is only drawn when the labels are. A mouse never met it — hovering had
already widened the rail. A tablet met a button that did nothing. Touching a
group now holds the rail open (`isPeekHeld`), and the next tap anywhere else,
or going somewhere, lets it go. This fixes the ordinary shell's collapsed
rail on tablets too.
