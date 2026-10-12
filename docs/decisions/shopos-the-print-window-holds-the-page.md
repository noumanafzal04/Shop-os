# After a print, the shop carries on

**2026-10-12.** Found by the owner, by hand, on the screens they were testing:

> "kuch button ko click krny k bad dobara click ni ho rhy — take away py maine
> aik order lia, print nikala to dobara print py click ni huwa — or fire to
> kitchen, usk bad again wahn click ni huwa, na settle py click hua — aise e
> sells page view modal main print, refund … jb dobara krta to app stuck
> hojati, kuch b work ni krta, koi b route."

and, fairly: *"to tum test kya kr rhy ho … aisi cheezain q bhool rhy ho."*

Built and tested; **not pushed** until they say.

## What it was

One print, anywhere, and nothing on any screen could be pressed again until the
page was reloaded. Reproduced in a real Chrome in four lines: press Print, close
the print window, read the button — still disabled; press Escape — the sheet
stays; the menu goes nowhere. `page.goto` works, because that is a reload.

`common/print.ts` had, since 6 October ("one print at a time"), declared a print
job finished **inside the frame's `afterprint` handler**. While its print window
is up Chrome holds the page still, and `afterprint` is delivered inside that
hold. The promise settled there; the screen waiting on it set its state; React
19 queued the microtask every one of its renders starts from; and **Chrome does
not run a `queueMicrotask` queued while it is holding the page** — it drops it,
with no error. React had marked a render as on the way and waited for ever.

Measured, not reasoned (the first theory — a lost `MessageChannel` message —
was tested and was wrong):

| the promise is settled | React's microtask | the toast | Print again |
|---|---|---|---|
| inside `afterprint` | queued, **never runs** | never drawn | dead |
| one task after it | queued, runs | drawn | works |
| after `print()` returns | queued, runs | drawn | works |

## Why six days of green tests

- A headless browser **has no print window**. `print()` returns at once and
  nothing is ever held.
- Most print specs go further and **replace `window.print`** with a recorder,
  to read what was printed. Right for what they check.
- So the one thing a cashier does with a print — look at a window, close it,
  carry on — had never happened in a test.

## The decision

1. **`afterprint` may only ask.** The finish (`release` the frame, settle the
   promise) is a task of its own — `setTimeout(…, 0)` — which the browser cannot
   start until it has let go of the page. Nothing of the app's runs while a
   print window is up.
2. **The frame is not taken away on a guess.** Where `print()` returns at once
   and nothing says the window closed (Safari), the *queue* moves on after
   1.5s, but the frame stays until `afterprint` or a 60s backstop — its window
   may still be printing from it.
3. **The keyboard goes back** to where it was before the frame took it.
4. **Print is tested with a real print window.** A Playwright project,
   `print-window`, runs in a browser you can see and closes the window the way
   a person does (through the browser's own debugging channel: find the
   `chrome://print` target, send it Escape). Five cases: the till (print, print
   again, next sale), a sale's sheet (print ×3, Return / Refund opens, Escape,
   the menu), the labels page (which prints the page itself), a tab (send →
   slip, bill ×2, settle), a restaurant's counter (slip, receipt ×2, slip
   again, next order, the way out).

       PRINT_WINDOW_CDP=http://127.0.0.1:9333 E2E_BASE_URL=http://localhost:5177 \
         npx playwright test --project=print-window

   With `PRINT_WINDOW_CDP` it opens a **tab in a browser already up** and leaves
   it up (the owner's wish: one window at the side, not one per run). Without
   it, it opens one window for the run.

## Proof it can fail

The old line (`win.onafterprint = closed`) put back **in a copy of the panel
served on its own port** — the owner was using the dev server — fails the
project: "after one print the button never came back", "the bill, asked for
again: the button cannot be pressed". The real tree: 5 of 5.

A real print (not a cancelled one) was also made once, with Chrome's kiosk
printing and no printer on the machine: three PDFs came out, three toasts,
Print stayed pressable. That mode is **not** in the committed spec — on a
machine with a printer it prints paper every run.

## What this does not do

- Safari and an iPad's print sheet were not driven: the code keeps the frame
  for them, but nothing here proves it.
- A print job is still named after the page ("Sales | True Serve"), not the
  receipt — what a "Save as PDF" file is called. Seen, not changed.

## Files

`panel/src/common/print.ts` · `panel/e2e/printWindow.ts`,
`print-window.counter.spec.ts`, `print-window.kitchen.spec.ts` ·
`panel/playwright.config.ts` (project `print-window`, kept out of every
headless project) · Help/QA: "print, close the window, press again".
