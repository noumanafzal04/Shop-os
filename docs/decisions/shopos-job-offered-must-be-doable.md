# A job offered must be a job that can be done

**2026-08-19** · backend `app/Support/StaffPresets.php` · sweep `docs/qa/sweep/phase_i.py`

## The bug

A restaurant was offered a **Purchasing** job it could not do.

`buyer` is described as *"Deals with suppliers, raises purchase orders and
records what was paid against them."* It was offered on `inventory` **OR**
`products`. A restaurant keeps a menu (`products`) and holds no stock
(`inventory`), so the job appeared in its list. Every screen in that sentence
sits behind `feature:inventory` — `routes/api.php` says so where the group is
declared: *"Suppliers — vendor directory + payables. Part of the stock chain, so
it rides the inventory module."*

So an owner could hire someone into Purchasing and that person could open
nothing. Suppliers, purchase orders, payables: all `MODULE_DISABLED`.

## The fix

`'modules' => ['inventory']`.

`stock_keeper` deliberately keeps both. Half of what it describes is keeping the
catalog straight, and that is real work in a kitchen that counts no stock.

Two tests, red on revert:

- a shop with no stock is not offered a purchasing job
- the five trades that hold stock still are

## Why nothing caught it for months

Phase I of the QA sweep ran on four shops out of eight, on a reason that had
expired: *"a preset matrix is about the PRESET, and running the same one on
seven shops costs seven logins against a 5/min limit to learn the same fact
once."* The token cache removed that cost long ago, and the claim was only half
right — **the preset list is built per trade**, so a workshop's and a salon's
had never once been looked at.

## The harness bug that hid it

Widening phase I produced **eleven bugs, all of them false.**

The check read any 403 on a job's own screen as *"this preset did not grant the
permission it promised."* But two different refusals wear the same number: in a
restaurant the shop's own **owner** gets the identical 403 on `/suppliers`,
because the module is not there. `MODULE_DISABLED` says nothing about
permissions.

Separating them was not just noise reduction. The module 403 turned out to be
the *sharper* question:

> A job every one of whose named screens is switched off is a job that should
> not have been offered.

That rule is what found the bug. It exists only because the false accusation was
chased down instead of silenced.

## The refinement that made it fire

A first version of the rule asked whether **all** of a job's reachable routes
were module-off, and found nothing — `buyer` can still open `/products`, because
`PRODUCTS_MANAGE` rides along in its permission list.

The rule had to be about the routes the job's **description** names, not
everything its permissions happen to touch. Hence `core` in the sweep's `JOBS`
matrix:

```python
"buyer": {
    # "Deals with suppliers, raises purchase orders and records what was
    # paid against them." /products rides along on PRODUCTS_MANAGE and is
    # not what anybody hires a buyer for.
    "core": ["/suppliers", "/purchase-orders"],
    ...
}
```

## Related

- `shopos-read-vs-manage.md` — the `*.manage` bug class, a write permission
  gating a read. Same family: a permission model answering the wrong question.
- `shopos-detector-vs-rule.md` — a guard that passes while blind to its subject.
  The eleven false bugs are that failure inside the tool written to find it.
