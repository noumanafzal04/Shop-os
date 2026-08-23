# Page two, asked of the list instead of the folder

**2026-08-23 · panel + docs/qa**

## The limit that was written down, and then hit

`unreachable-pages.py` has carried this in its own docblock since it was
written:

> The escape hatch is credited to a FOLDER, not to a LIST. A folder that shows
> two paginated lists and puts a search box on one of them reads as covered for
> both. … Fixing that properly needs per-list attribution.

Three defects were sitting inside exactly that gap.

## What was found

**A buyer could not reach their own older reservations.** The server has always
answered `paginate(15)`; the client was `reservations: () => apiGet(…)` — no
argument at all. A customer with sixteen holds could not see the sixteenth,
could not cancel it, and had no sign it existed. The rows that fall off are the
**oldest**, which is precisely where a forgotten hold sits: the shop is still
keeping a fridge off its shelf for somebody whose only way to say "never mind"
has scrolled out of reach.

**`useMyOrders` took a page and no screen ever gave it one.** The hook sent it
and kept previous data — somebody built paging deliberately. `MyOrdersPage`
called `useMyOrders()` and rendered no pager, so a buyer who had ordered sixteen
times could never look at the first one. Built, tested, wired to nothing: the
eighth time that shape has appeared here.

**Stocktake, which is the workshop lesson repeating.** `useStockCounts()` sent
no page against a `paginate(25)` endpoint, and the folder scan passed the screen
as **"search only"** — but the search it was credited for is the item lookup on
the count SHEET next door. The list itself has no search box; its one
placeholder reads "Pick a category". A shop's 26th stock count was unreachable,
and a stock count is the record you look *back* at, because it is where the shop
found out what was missing.

## The two questions the folder cannot ask

**Can this list's request ask for anything but page one?** Asked of the CALL, so
it needs no attribution at all. A call sending neither `page` nor `search`
cannot reach row 31 however many pagers exist elsewhere in its folder. Necessary,
not sufficient — the folder check still answers whether a person can press
anything.

**Does any hook offer a page that nobody asks for?** The shape the other two both
miss: the call *can* vary, the folder *does* hold a pager, and the one screen
that matters passes nothing.

## Getting the detector right cost more than the fixes

Worth recording in full, because every step was the same class of mistake:

- **Six findings, five of them the detector's fault.** The page was one function
  away (`params: toParams(filters)`) or in the caller's filter type
  (`(params: DisposalFilters = {})`). An audit that produces findings is a thing
  to verify, not to believe.
- **Widening the resolver made it blind.** Folding in every capitalised word
  after a colon swallowed `apiGet<CustomerReservation[]>`'s own type and enough
  neighbouring text to mention a page. The mutation planted to prove the check
  works slipped through it — twice.
- **A 500-character window is not a unit of meaning.** `marketplaceService` keeps
  `reservations` a few lines from a shop SEARCH, so the context contained the
  word and the call read as escapable. The window is now exactly one service
  member.
- **`if ".test." in f.name is False`.** Python parses that as a chained
  comparison — `(".test." in f.name) and (f.name is False)` — so it is always
  False and the file list was **empty**. The check printed "0 hooks offer a page
  nobody asks for" and looked identical to a clean result, including against the
  mutation. Only a denominator told them apart: the rule this whole file is built
  on, broken inside it.
- **`useDayHistory(listParams, tab === "history")`** was reported as never
  passing a page, because the first heuristic excluded any argument list
  containing an `=` and that one has three. Two working screens accused. The
  declaration is now excluded by what *precedes* it.

`--prove` blinds all three checks **by input** rather than skipping them, because
a check that is stepped over cannot be told apart from one that is broken — which
is the confusion the proving run exists to end. Blinded: 0 folders, 0 calls, 0
hooks. Real: 27, 33, 24.

## And the other denominator was lying too

The report has always printed a second figure — paginating routes that no screen
names — with a note saying it is "either a list nobody built yet or a path this
scan failed to recognise, and the two look identical from here". It sat at **2 of
38** for as long as the tool has existed.

Both were the second kind. A screen writes `` `/marketplace/shops/${slug}/products` ``
and Laravel writes `marketplace/shops/{slug}/products`; compared as characters
they never matched, so two routes that ARE fetched — by a screen that pages them
correctly — were reported as reached by nothing. Comparing by SHAPE fixes it, and
without weakening the rule the original comment protects: lengths must still be
equal, so `/products/{id}/branch-prices` cannot be mistaken for the product list.

**Naming a limit is not the same as fixing it.** That note was honest and it was
also two years of nobody looking.

## What is still not covered

The folder-level "search only" verdict can still be borrowed from the wrong
screen — the stocktake case was caught by the hook check, not by fixing the
attribution. Genuinely fixing it needs to know which call feeds which rendered
list, which regex cannot answer. Left as a stated limit rather than papered over.
