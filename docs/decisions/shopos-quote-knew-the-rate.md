# The quote knew each rate; the invoice it became forgot them

**Decided and shipped 2026-10-02.** Found by `loadtest:audit` the first time
the fixture had any sale documents in it — on exactly the four trades that
carry the documents module, and on no others, which is what pointed at the
conversion rather than at the till.

## The problem

A wholesale quotation for tea at 18% beside wheat flour at 0% is an ordinary
morning in Akbari Mandi. The document stores both rates, line by line,
snapshotted the day the price was given.

Converting it produced an invoice with **7.08% on both lines**. That figure is
the average: `840.42 ÷ 11,873`.

`ConvertSaleDocumentAction` passed the document's single settled `tax` and no
per-line rates, and `CreateSaleAction` does this on the trusted path:

```php
$blendedRate = $taxableBase > 0 ? round($tax / $taxableBase * 100, 4) : 0.0;
foreach ($lines as $i => $line) {
    $lines[$i]['tax_rate'] = $blendedRate;
}
```

## Why that blend exists, and why it was right

It was written for **online orders**. An order quotes ONE tax figure for the
basket — frequently zero — and genuinely has no per-line rate to carry.
Leaving the catalog's 17% on those lines would make a later return refund tax
the shop never collected. The blend is the correct answer there and stays.

What it was never reasoned about is a caller that *does* have the rates.

## What the average costs

| | |
|---|---|
| the flour line | refunded 7.08% tax on a **zero-rated staple** |
| the tea line | refunds less than the 18% that was charged |
| the tax report | grows a 7.08% band the shop is not registered for |
| the printed invoice | shows a rate against flour that FBR does not recognise |

None of it is visible until somebody brings something back, and by then the
money has left the drawer. The two errors also run in opposite directions and
very nearly cancel — 19 paisa on this bill — which is how it survived a green
suite and a hundred manual invoices.

## The decision

A line that **arrives with its own settled rate keeps it**; only the lines
that did not are blended.

```php
'settled_tax_rate' => $trusted && isset($item['tax_rate'])
    ? (float) $item['tax_rate']
    : null,

// …later
$lines[$i]['tax_rate'] = $line['settled_tax_rate'] ?? $blendedRate;
```

Fenced behind `$trusted`, so an ordinary till request can no more send its own
tax rate than it can send its own price.

`ConvertSaleDocumentAction` then carries `$item->tax_rate` from each document
line onto the sale line. Nothing about what the customer pays changes: the
conversion is a promise being kept, and the tax on the invoice is still the
tax that was quoted.

## Proof

`tests/Feature/TheQuoteKnewTheRateTest.php` — five tests, and the one that
matters most is the last: **an order with no quoted rates is still blended.**
Removing the carried rate fails two of the five; removing the blend would fail
that one. Both halves of the rule are held down.

The audit's `theTaxOnEveryLine` check, which found this, now agrees on all
nine shops.
