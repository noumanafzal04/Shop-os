{{--
    The paper a customer walks out with BEFORE they've bought anything.

    Two documents, one sheet, because they carry the same weight: a written
    price the shop has committed to. The differences are exactly two —

      QUOTATION — "Valid until". Nothing has been paid, nothing is held. The
                  date is the promise, so it is the loudest thing after the
                  total.
      LAYAWAY   — "Collect by", plus the money panel: what was paid, what is
                  owed, and every instalment listed. That list is the customer's
                  only proof of what they've handed over, so it prints in full
                  rather than as a running total they'd have to trust.

    Both carry the shop's terms and a signature line: this is a document that
    gets argued about weeks later, and an unsigned estimate is worth what the
    customer says it's worth.
--}}
@php
    $width   = $paper ?? ($settings['receipt_width'] ?? 'standard');
    $roll    = in_array($width, ['thermal_58', 'thermal_80'], true);
    $rollMm  = $width === 'thermal_58' ? '48mm' : '72mm';

    $cur     = $settings['currency_symbol'] ?? 'Rs';
    $layaway = $document->isLayaway();
    $lapsed  = $document->hasLapsed();
    $balance = $document->balance();

    $money = fn ($n) => number_format((float) $n, 2);
    $qty   = fn ($n) => rtrim(rtrim(number_format((float) $n, 3, '.', ''), '0'), '.') ?: '0';

    $methodLabel = [
        'cash' => 'Cash', 'card' => 'Card', 'bank_transfer' => 'Bank transfer', 'other' => 'Other',
    ];

    $docTitle = $layaway ? 'Advance Booking' : 'Quotation';
    $dateLabel = $layaway ? 'Collect by' : 'Valid until';

    $ntn  = $settings['invoice_ntn'] ?? null;
    $strn = $settings['invoice_strn'] ?? null;

    $lineDiscounts = $document->items->sum(fn ($i) => (float) $i->line_discount);
    $anyDiscount   = $lineDiscounts > 0 || (float) $document->discount > 0;
    $payments      = $document->relationLoaded('payments') ? $document->payments : collect();
@endphp
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $document->number }} — {{ $tenant->business_name }}</title>
    <style>
        :root { --ink:#101828; --soft:#667085; --rule:#d0d5dd; --hair:#eaecf0; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body {
            color: var(--ink);
            background: {{ $roll ? '#fff' : '#f2f4f7' }};
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
            @if($roll)
                font: 12px/1.45 "Menlo", "Consolas", "DejaVu Sans Mono", monospace;
                padding: 8px 6px 20px;
            @else
                font: 13px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                padding: 24px 16px 40px;
            @endif
        }
        .doc {
            width: {{ $roll ? $rollMm : '760px' }};
            max-width: 100%;
            margin: 0 auto;
            @if(! $roll)
                background:#fff; padding:40px; border-radius:4px;
                box-shadow:0 1px 3px rgba(16,24,40,.1);
            @endif
        }
        .c { text-align:center; } .r { text-align:right; }
        .soft { color: var(--soft); } .b { font-weight:700; }
        .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .rule { border:0; border-top:1px {{ $roll ? 'dashed' : 'solid' }} var(--rule); margin:{{ $roll ? '7px 0' : '20px 0' }}; }
        .hair { border:0; border-top:1px solid var(--hair); margin:{{ $roll ? '5px 0' : '12px 0' }}; }

        .logo { max-height:{{ $roll ? '48px' : '64px' }}; max-width:100%; margin-bottom:6px; }
        .shop { font-size:{{ $roll ? '15px' : '22px' }}; font-weight:700; margin:0; letter-spacing:{{ $roll ? '.02em' : '-.01em' }}; }
        .doctype { font-size:{{ $roll ? '11px' : '12px' }}; text-transform:uppercase; letter-spacing:.12em; color:var(--soft); }
        .taxids { font-size:{{ $roll ? '10px' : '11px' }}; color:var(--soft); }

        /* The validity date is the promise — it gets a box, not a footnote. */
        .validity {
            display:inline-block; border:1.5px solid var(--ink);
            padding:{{ $roll ? '3px 6px' : '6px 14px' }};
            font-weight:700; text-transform:uppercase; letter-spacing:.1em;
            font-size:{{ $roll ? '10px' : '12px' }};
        }
        .validity.lapsed { border-color:#b42318; color:#b42318; }

        .meta { width:100%; border-collapse:collapse; font-size:{{ $roll ? '11px' : '12px' }}; }
        .meta td { padding:2px 0; vertical-align:top; }
        .meta td.k { color:var(--soft); padding-right:10px; white-space:nowrap; }

        table.items { width:100%; border-collapse:collapse; font-size:{{ $roll ? '11px' : '13px' }}; }
        table.items th {
            text-align:left; font-weight:600; color:var(--soft);
            font-size:{{ $roll ? '10px' : '11px' }}; text-transform:uppercase; letter-spacing:.06em;
            padding:{{ $roll ? '3px 0' : '8px 6px' }};
            border-bottom:1px solid var(--rule);
        }
        table.items td { padding:{{ $roll ? '3px 0' : '9px 6px' }}; border-bottom:1px solid var(--hair); vertical-align:top; }
        table.items tr:last-child td { border-bottom:0; }

        .totals { width:{{ $roll ? '100%' : '320px' }}; margin-left:auto; border-collapse:collapse; font-size:{{ $roll ? '12px' : '13px' }}; }
        .totals td { padding:{{ $roll ? '2px 0' : '5px 0' }}; }
        .totals tr.grand td { font-size:{{ $roll ? '14px' : '17px' }}; font-weight:700; padding-top:8px; border-top:1.5px solid var(--ink); }
        .totals tr.due td { font-size:{{ $roll ? '13px' : '15px' }}; font-weight:700; }

        .sign { display:flex; gap:40px; margin-top:{{ $roll ? '18px' : '48px' }}; }
        .sign div { flex:1; border-top:1px solid var(--rule); padding-top:6px; font-size:{{ $roll ? '10px' : '11px' }}; color:var(--soft); }

        .terms { font-size:{{ $roll ? '10px' : '11px' }}; color:var(--soft); white-space:pre-line; }

        @media print {
            body { background:#fff; padding:0; }
            .doc { box-shadow:none; width:auto; padding:{{ $roll ? '0' : '12mm' }}; }
            @page { margin:{{ $roll ? '2mm' : '10mm' }}; size:{{ $roll ? $width === 'thermal_58' ? '58mm auto' : '80mm auto' : 'A4' }}; }
        }
    </style>
</head>
<body>
<div class="doc">

    {{-- ── Masthead ──────────────────────────────────────────────── --}}
    <div class="c">
        @if(($settings['invoice_show_logo'] ?? true) && $tenant->logo_url)
            <img class="logo" src="{{ $tenant->logo_url }}" alt="">
        @endif
        <p class="shop">{{ $tenant->business_name }}</p>
        @if($settings['invoice_header'] ?? null)
            <div class="soft" style="font-size:{{ $roll ? '11px' : '12px' }}">{{ $settings['invoice_header'] }}</div>
        @endif
        @if($tenant->address)
            <div class="soft" style="font-size:{{ $roll ? '10px' : '11px' }}">{{ $tenant->address }}</div>
        @endif
        @if($tenant->phone)
            <div class="soft" style="font-size:{{ $roll ? '10px' : '11px' }}">{{ $tenant->phone }}</div>
        @endif
        @if($ntn || $strn)
            <div class="taxids">
                @if($ntn) NTN {{ $ntn }} @endif
                @if($ntn && $strn) · @endif
                @if($strn) STRN {{ $strn }} @endif
            </div>
        @endif
        <div class="doctype" style="margin-top:6px">{{ $docTitle }}</div>
    </div>

    <hr class="rule">

    {{-- ── Who, what number, and until when ──────────────────────── --}}
    <table class="meta">
        <tr>
            <td class="k">Number</td>
            <td class="b">{{ $document->number }}</td>
        </tr>
        <tr>
            <td class="k">Date</td>
            <td>{{ $document->created_at?->format('d M Y, h:i A') }}</td>
        </tr>
        @if($document->customer_name || $document->customer_phone)
            <tr>
                <td class="k">Customer</td>
                <td>
                    {{ $document->customer_name ?: '—' }}
                    @if($document->customer_phone)
                        <span class="soft">· {{ $document->customer_phone }}</span>
                    @endif
                </td>
            </tr>
        @endif
        @if($document->branch)
            <tr><td class="k">Branch</td><td>{{ $document->branch->name }}</td></tr>
        @endif
    </table>

    @if($document->expires_at)
        <div style="margin-top:{{ $roll ? '8px' : '16px' }}" class="{{ $roll ? 'c' : '' }}">
            <span class="validity {{ $lapsed ? 'lapsed' : '' }}">
                {{ $lapsed ? ($layaway ? 'Overdue since' : 'Expired on') : $dateLabel }}
                {{ $document->expires_at->format('d M Y') }}
            </span>
        </div>
    @endif

    <hr class="rule">

    {{-- ── The items ─────────────────────────────────────────────── --}}
    <table class="items">
        <thead>
        <tr>
            <th>Item</th>
            <th class="r">Qty</th>
            @if(! $roll)<th class="r">Rate</th>@endif
            <th class="r">Amount</th>
        </tr>
        </thead>
        <tbody>
        @foreach($document->items as $item)
            <tr>
                <td>
                    {{ $item->product_name }}
                    @if($item->variant_name)<span class="soft"> · {{ $item->variant_name }}</span>@endif
                    @if($item->unit_name)<span class="soft"> ({{ $item->unit_name }})</span>@endif
                    @if($item->sku)<div class="soft" style="font-size:{{ $roll ? '10px' : '11px' }}">{{ $item->sku }}</div>@endif
                    @if($roll)
                        <div class="soft num" style="font-size:10px">{{ $qty($item->quantity) }} × {{ $money($item->unit_price) }}</div>
                    @endif
                    @if((float) $item->line_discount > 0)
                        <div class="soft" style="font-size:{{ $roll ? '10px' : '11px' }}">
                            less {{ $cur }} {{ $money($item->line_discount) }}
                        </div>
                    @endif
                </td>
                <td class="r num">{{ $qty($item->quantity) }}</td>
                @if(! $roll)<td class="r num">{{ $money($item->unit_price) }}</td>@endif
                <td class="r num">{{ $money($item->line_total) }}</td>
            </tr>
        @endforeach
        </tbody>
    </table>

    <hr class="hair">

    {{-- ── Totals ────────────────────────────────────────────────── --}}
    <table class="totals">
        <tr>
            <td class="soft">Subtotal</td>
            <td class="r num">{{ $cur }} {{ $money($document->subtotal) }}</td>
        </tr>
        @if($anyDiscount)
            <tr>
                <td class="soft">Discount</td>
                <td class="r num">− {{ $cur }} {{ $money((float) $document->discount + $lineDiscounts) }}</td>
            </tr>
        @endif
        @if((float) $document->tax > 0)
            <tr>
                <td class="soft">
                    Tax{{ $document->tax_inclusive ? ' (included)' : '' }}
                </td>
                <td class="r num">{{ $cur }} {{ $money($document->tax) }}</td>
            </tr>
        @endif
        <tr class="grand">
            <td>Total</td>
            <td class="r num">{{ $cur }} {{ $money($document->total) }}</td>
        </tr>

        {{-- The money panel — layaway only. A quotation has no money on it,
             and printing "Paid: 0.00" on an estimate invites the question. --}}
        @if($layaway)
            <tr>
                <td class="soft">Advance paid</td>
                <td class="r num">− {{ $cur }} {{ $money($document->deposit_paid) }}</td>
            </tr>
            <tr class="due">
                <td>Balance due</td>
                <td class="r num">{{ $cur }} {{ $money($balance) }}</td>
            </tr>
        @endif
    </table>

    {{-- ── Every instalment, listed ──────────────────────────────── --}}
    @if($layaway && $payments->isNotEmpty())
        <hr class="hair">
        <div class="soft b" style="font-size:{{ $roll ? '10px' : '11px' }}; text-transform:uppercase; letter-spacing:.08em; margin-bottom:4px">
            Payments received
        </div>
        <table class="items">
            <tbody>
            @foreach($payments as $payment)
                <tr>
                    <td>
                        {{ $payment->paid_at?->format('d M Y') }}
                        <span class="soft">· {{ $methodLabel[$payment->method] ?? $payment->method }}</span>
                        @if($payment->reference)<span class="soft"> · {{ $payment->reference }}</span>@endif
                    </td>
                    <td class="r num">{{ $cur }} {{ $money($payment->amount) }}</td>
                </tr>
            @endforeach
            </tbody>
        </table>
    @endif

    {{-- ── Terms ─────────────────────────────────────────────────── --}}
    @if($document->terms)
        <hr class="rule">
        <div class="soft b" style="font-size:{{ $roll ? '10px' : '11px' }}; text-transform:uppercase; letter-spacing:.08em; margin-bottom:4px">
            Terms
        </div>
        <div class="terms">{{ $document->terms }}</div>
    @endif

    @if($document->notes)
        <hr class="hair">
        <div class="terms">{{ $document->notes }}</div>
    @endif

    {{-- Goods held are the shop's risk until collected — say so on the paper,
         once, in the customer's language rather than a lawyer's. --}}
    @if($layaway)
        <hr class="hair">
        <div class="terms">
            These goods are set aside in your name and will be handed over once the balance is paid in full.
        </div>
    @endif

    <div class="sign">
        <div>Customer signature</div>
        <div>For {{ $tenant->business_name }}</div>
    </div>

    @if($settings['invoice_footer'] ?? null)
        <hr class="hair">
        <div class="c soft" style="font-size:{{ $roll ? '10px' : '11px' }}">{{ $settings['invoice_footer'] }}</div>
    @endif
</div>
</body>
</html>
