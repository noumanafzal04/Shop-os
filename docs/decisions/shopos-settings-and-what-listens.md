# Settings, and whether anything listens to them

**2026-10-06 · QA journey, stage G**

> "Shop setting main hr tab ko achy sy test kro, specially POS setting or uski
> sub tab — jahan jahan inki setting save ho rhi, use ho rhi wahan ya ni."

A setting has three chances to be broken, and a test that checks one of them
passes on a switch that does nothing: it does not SAVE, it does not SURVIVE a
reload, or nothing READS it. Stage G changes each setting on the Settings
screen, reloads, and then goes to the place the setting is about. 59 settings,
8 tabs, 4 POS sub-tabs, 30 cases.

## What it found

**"Ask for a tip at checkout" did nothing at the counter.** Its own card says
tipping is "not a restaurant feature — a salon, a workshop and a delivery
service all take them", and the switch was read by the dine-in tab and
nothing else. The counter till now has a Tip box. A tip is in what the
customer hands over (and in the coin a cash bill settles to — it is added
BEFORE the coin is found) and never in the bill, the tax or a discount.
`tillBill` is held to three server fixtures; the one that matters uses a tip
that is not a round ten, because with a round one both orders of arithmetic
give the same answer.

**Save put back whatever had changed elsewhere.** The screen took one copy of
all 59 settings when it opened and Save sent the whole copy back. Choose a
colour in Appearance, come back, flip "Show price", press Save: the colour
reverted, and both screens said "Settings saved". It now sends only the keys
touched on this screen and shows what the server holds for the rest.

**One wrong PIN was two.** The API client treated every 401 as an expired
session: refresh, send again. A wrong till PIN is 401 `INVALID_CREDENTIALS`,
so it was checked twice — frozen out in half the tries, a refresh token spent
each time. Only a 401 that names the session (`UNAUTHENTICATED`, or nothing)
is retried. The same rule is in `core/src/api/client.ts` and was not changed.

**Kitchen stations could not be typed.** The box turned every keystroke back
into a list and redrew from the list, so Enter and a trailing space were gone
before the next key: no second station, and "Hot Grill" became "HotGrill".
What is being typed and what it means are two things; `StationsField` keeps
the first and hands up the second.

**Four text areas had no name**, announced by their placeholder.
`NamedTextarea`; a guard refuses the next raw `<textarea>`.

## Hardware: what actually connects

The device form offers seven connections. The till is a web page and can do
two things:

| | How | When |
|---|---|---|
| Print | the computer's own print window | always — any printer the computer can print to |
| Open a drawer | a pulse down a serial line (Web Serial) | Chrome or Edge on a computer, device set to Serial or USB, after "Connect drawer" once |
| Scan | the scanner types like a keyboard | always |
| Weigh | the scale prints a label the till reads | when scale labels are on and the item has a PLU — online and offline |

Bluetooth, network, Wi-Fi and "built-in" are a note; the address box connects
to nothing. The form now says so under the list, and the words are tied by a
test to `canKick()`, the rule the till itself uses.

## Everything else was obeyed

Default payment, cash rounding, who-served, auto-print, idle lock, require
shift, blind close / note count / card declaration, the discount ceiling,
till PINs, registers, quotation validity and terms, minimum advance, default
tax, tax-inclusive, delivery limits, loyalty, receipt fields, label fields,
scale labels, and a lane's own printer over the shop's paper.
