# A scale's price label is whole rupees

**2026-10-07 · decided on the owner's word: "decimal chahiye hi nahi hota invoices mein"**

A price-embedded scale label carries five digits. They were read as paisa —
`00450` rang up Rs 4.50, and no label could say more than Rs 999.99.

Whole rupees is how a scale is set up here, so it is the default
(`scale_price_decimals: 0`): `00450` is Rs 450, and a label reaches
Rs 99,999. A shop whose scale really prints paisa says so under Settings →
Barcodes → Scale barcodes → **Price on the label** (shown only when the label
encodes a price). Weight labels are unchanged.

One parser on the server (`ScaleBarcode`), one in the offline till
(`scaleLabel.ts`), and one fixture file both are held to
(`scale-labels.json`, version 2: rupees, past a thousand, and paisa).
