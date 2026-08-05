{{--
    The receipt. Two genuinely different documents share this file, because a
    58mm roll and an A4 tax invoice are not the same design at different sizes:

      ROLL  (thermal_58 / thermal_80) — one narrow column, centred masthead,
            dashed rules, no borders or fills (thermal heads render solid grey
            as mush, and the ink is the customer's, not ours).
      SHEET (standard)                — a filed document: masthead, meta grid,
            ruled item table, totals panel, signature line.

    Everything a counter dispute needs is on the paper: invoice no, date, lane,
    cashier, every tender, and — when it is not the first copy — the fact that
    it is a copy.
--}}
@php
    $width   = $settings['receipt_width'] ?? 'standard';
    $roll    = in_array($width, ['thermal_58', 'thermal_80'], true);
    $paperMm = $width === 'thermal_58' ? '58mm' : ($width === 'thermal_80' ? '80mm' : 'auto');
    $rollMm  = $width === 'thermal_58' ? '48mm' : '72mm';

    $cur     = $settings['currency_symbol'] ?? 'Rs';
    $kind    = $kind ?? 'original';
    $copyNo  = $copyNo ?? 1;
    $cashier = $cashier ?? null;
    $preview = $preview ?? false;
    $gift    = $kind === 'gift';
    $isCopy  = $copyNo > 1;

    $money = fn ($n) => number_format((float) $n, 2);
    // 2.000 kg reads wrong on a receipt; 2 does. Keep real fractions.
    $qty   = fn ($n) => rtrim(rtrim(number_format((float) $n, 3, '.', ''), '0'), '.') ?: '0';

    $payments  = $sale->relationLoaded('payments') ? $sale->payments : collect();
    $serials   = $sale->relationLoaded('serials') ? $sale->serials : collect();
    $cancelled = $sale->isCancelled();

    $methodLabel = [
        'cash' => 'Cash', 'card' => 'Card', 'bank_transfer' => 'Bank transfer',
        'credit' => 'On account (khata)', 'other' => 'Other', 'split' => 'Split',
        // A layaway collected: the customer paid this weeks ago, and the
        // receipt has to say so or it reads as if they paid twice today.
        'deposit' => 'Advance paid earlier',
    ];

    $ntn   = $settings['invoice_ntn'] ?? null;
    $strn  = $settings['invoice_strn'] ?? null;
    $fbr   = $settings['invoice_fbr_pos_id'] ?? null;
    $taxed = (float) $sale->tax > 0;
    // A registered shop issues a "Sales Tax Invoice"; everyone else a receipt.
    $docTitle = ($ntn || $strn) && $taxed ? 'Sales Tax Invoice' : 'Sales Invoice';

    $lineDiscounts = $sale->items->sum(fn ($i) => (float) $i->line_discount);
    $anyDiscount   = $lineDiscounts > 0 || (float) $sale->discount > 0 || (float) $sale->promo_discount > 0;
@endphp
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $sale->invoice_number }} — {{ $tenant->business_name }}</title>
    <style>
        :root {
            --ink: #101828;
            --soft: #667085;
            --rule: #d0d5dd;
            --hair: #eaecf0;
        }
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
                background: #fff; padding: 40px; border-radius: 4px;
                box-shadow: 0 1px 3px rgba(16,24,40,.1);
            @endif
        }
        .c { text-align: center; }
        .r { text-align: right; }
        .soft { color: var(--soft); }
        .b { font-weight: 700; }
        .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .rule { border: 0; border-top: 1px {{ $roll ? 'dashed' : 'solid' }} var(--rule); margin: {{ $roll ? '7px 0' : '20px 0' }}; }
        .hair { border: 0; border-top: 1px solid var(--hair); margin: {{ $roll ? '5px 0' : '12px 0' }}; }

        /* ── Masthead ─────────────────────────────────────────────── */
        .logo { max-height: {{ $roll ? '48px' : '64px' }}; max-width: 100%; margin-bottom: 6px; }
        .shop { font-size: {{ $roll ? '15px' : '22px' }}; font-weight: 700; margin: 0; letter-spacing: {{ $roll ? '.02em' : '-.01em' }}; }
        .doctype { font-size: {{ $roll ? '11px' : '12px' }}; text-transform: uppercase; letter-spacing: .12em; color: var(--soft); }
        .taxids { font-size: {{ $roll ? '10px' : '11px' }}; color: var(--soft); }

        /* ── The copy stamp ───────────────────────────────────────── */
        .stamp {
            border: 1.5px solid var(--ink); padding: {{ $roll ? '3px 6px' : '6px 14px' }};
            font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
            font-size: {{ $roll ? '11px' : '13px' }};
            display: inline-block;
        }
        .stamp.void { border-color: #b42318; color: #b42318; }

        /* ── Meta ─────────────────────────────────────────────────── */
        .meta { width: 100%; font-size: {{ $roll ? '11px' : '12px' }}; }
        .meta td { padding: 1px 0; vertical-align: top; }
        .meta td:last-child { text-align: right; }
        @if(! $roll)
            .metagrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px 20px; }
            .metagrid dt { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--soft); margin: 0 0 2px; }
            .metagrid dd { margin: 0; font-weight: 600; }
        @endif

        /* ── Items ────────────────────────────────────────────────── */
        table.items { width: 100%; border-collapse: collapse; }
        table.items th {
            font-size: {{ $roll ? '10px' : '10px' }}; text-transform: uppercase; letter-spacing: .06em;
            color: var(--soft); font-weight: 600; text-align: left;
            padding: {{ $roll ? '3px 0' : '0 8px 8px' }};
            border-bottom: 1px solid var(--rule);
        }
        table.items td { padding: {{ $roll ? '3px 0' : '9px 8px' }}; vertical-align: top; }
        @if(! $roll)
            table.items tbody tr + tr td { border-top: 1px solid var(--hair); }
            table.items th:first-child, table.items td:first-child { padding-left: 0; }
            table.items th:last-child, table.items td:last-child { padding-right: 0; }
        @endif
        .lname { font-weight: 600; }
        .lmeta { font-size: {{ $roll ? '10px' : '11px' }}; color: var(--soft); }

        /* ── Totals ───────────────────────────────────────────────── */
        .totals { width: {{ $roll ? '100%' : '300px' }}; margin-left: auto; font-size: {{ $roll ? '12px' : '13px' }}; }
        .totals tr td { padding: {{ $roll ? '2px 0' : '5px 0' }}; }
        .totals tr td:last-child { text-align: right; }
        .grand td { font-size: {{ $roll ? '15px' : '18px' }}; font-weight: 700; padding-top: {{ $roll ? '6px' : '10px' }} !important; border-top: 1.5px solid var(--ink); }
        .tender td { color: var(--soft); }
        .tender.change td { color: var(--ink); font-weight: 600; }

        /* ── Footer ───────────────────────────────────────────────── */
        .foot { margin-top: {{ $roll ? '12px' : '28px' }}; font-size: {{ $roll ? '11px' : '12px' }}; }
        .sign { margin-top: 48px; display: flex; justify-content: space-between; gap: 40px; }
        .sign div { flex: 1; border-top: 1px solid var(--rule); padding-top: 6px; font-size: 11px; color: var(--soft); }

        .toolbar {
            position: fixed; top: 0; left: 0; right: 0; z-index: 9;
            display: flex; gap: 8px; justify-content: center; align-items: center;
            padding: 10px; background: #101828; color: #fff; font: 12px/1 -apple-system, "Segoe UI", Roboto, sans-serif;
        }
        .toolbar button {
            font: inherit; padding: 7px 18px; border-radius: 6px; border: 0;
            background: #fff; color: #101828; font-weight: 600; cursor: pointer;
        }
        body.has-toolbar { padding-top: 52px; }

        @media print {
            body { background: #fff; padding: 0; }
            body.has-toolbar { padding-top: 0; }
            .doc { width: auto; box-shadow: none; padding: {{ $roll ? '0' : '0' }}; border-radius: 0; }
            .no-print { display: none !important; }
            @page { size: {{ $paperMm === 'auto' ? 'A4' : $paperMm.' auto' }}; margin: {{ $roll ? '3mm' : '14mm' }}; }
        }
    </style>
</head>
<body class="{{ $preview ? '' : 'has-toolbar' }}">

@unless($preview)
    <div class="toolbar no-print">
        <span>{{ $sale->invoice_number }}</span>
        <button onclick="window.print()">Print</button>
    </div>
@endunless

<div class="doc">

    {{-- ══ Masthead ══════════════════════════════════════════════ --}}
    @if($roll)
        <div class="c">
            @if(($settings['invoice_show_logo'] ?? true) && $tenant->logo_path)
                <img class="logo" src="{{ \Illuminate\Support\Facades\Storage::disk('public')->url($tenant->logo_path) }}" alt="">
            @endif
            <div class="shop">{{ $tenant->business_name }}</div>
            @if(!empty($settings['invoice_header']))<div class="soft">{{ $settings['invoice_header'] }}</div>@endif
            @if($tenant->address)<div class="soft">{{ $tenant->address }}</div>@endif
            @if($tenant->phone)<div class="soft">Tel {{ $tenant->phone }}</div>@endif
            @if($ntn || $strn)
                <div class="taxids">
                    {{ $ntn ? 'NTN '.$ntn : '' }}{{ $ntn && $strn ? '  ·  ' : '' }}{{ $strn ? 'STRN '.$strn : '' }}
                </div>
            @endif
            @if($fbr)<div class="taxids">FBR POS {{ $fbr }}</div>@endif
            <div class="doctype" style="margin-top:6px">{{ $docTitle }}</div>
            {{-- On a roll the stamp goes at the TOP: it is the first thing the
                 customer and the next cashier see, before the numbers. --}}
            @if($cancelled)
                <div style="margin-top:6px"><span class="stamp void">Cancelled</span></div>
            @elseif($gift)
                <div style="margin-top:6px"><span class="stamp">Gift Receipt</span></div>
            @elseif($isCopy)
                <div style="margin-top:6px"><span class="stamp">Reprint · Copy {{ $copyNo }}</span></div>
            @endif
        </div>
    @else
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:32px">
            <div>
                @if(($settings['invoice_show_logo'] ?? true) && $tenant->logo_path)
                    <img class="logo" src="{{ \Illuminate\Support\Facades\Storage::disk('public')->url($tenant->logo_path) }}" alt="">
                @endif
                <div class="shop">{{ $tenant->business_name }}</div>
                @if(!empty($settings['invoice_header']))<div class="soft">{{ $settings['invoice_header'] }}</div>@endif
                @if($tenant->address)<div class="soft">{{ $tenant->address }}</div>@endif
                @if($tenant->phone)<div class="soft">Tel {{ $tenant->phone }}</div>@endif
                @if($ntn || $strn || $fbr)
                    <div class="taxids" style="margin-top:6px">
                        @if($ntn)<div>NTN {{ $ntn }}</div>@endif
                        @if($strn)<div>STRN {{ $strn }}</div>@endif
                        @if($fbr)<div>FBR POS {{ $fbr }}</div>@endif
                    </div>
                @endif
            </div>
            <div class="r">
                <div class="doctype">{{ $docTitle }}</div>
                <div class="shop" style="font-size:20px">{{ $sale->invoice_number }}</div>
                <div class="soft">{{ optional($sale->sold_at)->format('d M Y · h:i A') }}</div>
                @if($cancelled || $isCopy || $gift)
                    <div style="margin-top:10px">
                        @if($cancelled)
                            <span class="stamp void">Cancelled</span>
                        @elseif($gift)
                            <span class="stamp">Gift Receipt</span>
                        @else
                            <span class="stamp">Reprint · Copy {{ $copyNo }}</span>
                        @endif
                    </div>
                @endif
            </div>
        </div>
    @endif

    <hr class="rule">

    {{-- ══ Meta: who, where, when ════════════════════════════════ --}}
    @if($roll)
        <table class="meta">
            <tr><td class="soft">Invoice</td><td class="b">{{ $sale->invoice_number }}</td></tr>
            <tr><td class="soft">Date</td><td>{{ optional($sale->sold_at)->format('d M Y · h:i A') }}</td></tr>
            @if(($settings['receipt_show_cashier'] ?? true) && $cashier)
                <tr><td class="soft">Served by</td><td>{{ $cashier }}</td></tr>
            @endif
            @if($sale->register)
                <tr><td class="soft">Counter</td><td>{{ $sale->register->name }}</td></tr>
            @endif
            @if($sale->branch && $sale->branch->name)
                <tr><td class="soft">Branch</td><td>{{ $sale->branch->name }}</td></tr>
            @endif
            @if($sale->customer_name || $sale->customer_phone)
                <tr><td class="soft">Customer</td><td>{{ $sale->customer_name ?: $sale->customer_phone }}</td></tr>
                @if($sale->customer_name && $sale->customer_phone)
                    <tr><td></td><td>{{ $sale->customer_phone }}</td></tr>
                @endif
            @endif
            @if($sale->order_type || $sale->table_no)
                <tr><td class="soft">Order</td><td>{{ ucfirst(str_replace('_', ' ', (string) $sale->order_type)) }} {{ $sale->table_no ? '· Table '.$sale->table_no : '' }}</td></tr>
            @endif
        </table>
    @else
        <dl class="metagrid">
            <div>
                <dt>Billed to</dt>
                <dd>{{ $sale->customer_name ?: 'Walk-in customer' }}</dd>
                @if($sale->customer_phone)<dd class="soft" style="font-weight:400">{{ $sale->customer_phone }}</dd>@endif
            </div>
            @if(($settings['receipt_show_cashier'] ?? true) && $cashier)
                <div><dt>Served by</dt><dd>{{ $cashier }}</dd></div>
            @endif
            @if($sale->register)
                <div><dt>Counter</dt><dd>{{ $sale->register->name }}</dd></div>
            @endif
            @if($sale->branch && $sale->branch->name)
                <div><dt>Branch</dt><dd>{{ $sale->branch->name }}</dd></div>
            @endif
            @if($sale->order_type || $sale->table_no)
                <div>
                    <dt>Order</dt>
                    <dd>{{ ucfirst(str_replace('_', ' ', (string) $sale->order_type)) }}{{ $sale->table_no ? ' · Table '.$sale->table_no : '' }}</dd>
                </div>
            @endif
        </dl>
    @endif

    {{-- ℞ — a dispensed prescription is part of the legal record of the sale. --}}
    @if($sale->prescription_number || $sale->prescriber_name || $sale->patient_name)
        <hr class="hair">
        <div class="lmeta">
            <span class="b">℞</span>
            {{ $sale->prescription_number ? 'No. '.$sale->prescription_number : '' }}
            {{ $sale->patient_name ? ' · Patient: '.$sale->patient_name : '' }}
            {{ $sale->prescriber_name ? ' · Prescriber: '.$sale->prescriber_name : '' }}
        </div>
    @endif

    <hr class="rule">

    {{-- ══ Items ═════════════════════════════════════════════════ --}}
    @if($roll)
        <table class="items">
            <thead>
            <tr>
                <th>Item</th>
                @unless($gift)<th class="r" style="width:34%">Amount</th>@endunless
            </tr>
            </thead>
            <tbody>
            @foreach($sale->items as $item)
                <tr>
                    <td>
                        <div class="lname">{{ $item->product_name }}</div>
                        @if($item->variant_name || $item->unit_name)
                            <div class="lmeta">{{ trim(($item->variant_name ?? '').($item->variant_name && $item->unit_name ? ' · ' : '').($item->unit_name ?? '')) }}</div>
                        @endif
                        @if(!empty($item->modifiers))
                            <div class="lmeta">
                                @foreach($item->modifiers as $mod)
                                    + {{ is_array($mod) ? ($mod['name'] ?? '') : $mod }}@if(!$loop->last), @endif
                                @endforeach
                            </div>
                        @endif
                        <div class="lmeta num">
                            {{ $qty($item->quantity) }} × {{ $gift ? '—' : $money($item->unit_price) }}
                            @if(! $gift && (float) $item->line_discount > 0)
                                &nbsp;· less {{ $money($item->line_discount) }}
                            @endif
                        </div>
                    </td>
                    @unless($gift)
                        <td class="r num b">{{ $money($item->line_total) }}</td>
                    @endunless
                </tr>
            @endforeach
            </tbody>
        </table>
    @else
        <table class="items">
            <thead>
            <tr>
                <th style="width:34px">#</th>
                <th>Description</th>
                <th class="r" style="width:70px">Qty</th>
                @unless($gift)
                    <th class="r" style="width:100px">Rate</th>
                    @if($lineDiscounts > 0)<th class="r" style="width:90px">Discount</th>@endif
                    <th class="r" style="width:110px">Amount</th>
                @endunless
            </tr>
            </thead>
            <tbody>
            @foreach($sale->items as $item)
                <tr>
                    <td class="soft num">{{ $loop->iteration }}</td>
                    <td>
                        <div class="lname">{{ $item->product_name }}</div>
                        @if($item->variant_name || $item->unit_name || $item->sku)
                            <div class="lmeta">
                                {{ $item->variant_name }}{{ $item->variant_name && $item->unit_name ? ' · ' : '' }}{{ $item->unit_name }}
                                @if($item->sku)<span>{{ ($item->variant_name || $item->unit_name) ? ' · ' : '' }}SKU {{ $item->sku }}</span>@endif
                            </div>
                        @endif
                        @if(!empty($item->modifiers))
                            <div class="lmeta">
                                @foreach($item->modifiers as $mod)
                                    + {{ is_array($mod) ? ($mod['name'] ?? '') : $mod }}@if(!$loop->last), @endif
                                @endforeach
                            </div>
                        @endif
                    </td>
                    <td class="r num">{{ $qty($item->quantity) }}</td>
                    @unless($gift)
                        <td class="r num">{{ $money($item->unit_price) }}</td>
                        @if($lineDiscounts > 0)
                            <td class="r num">{{ (float) $item->line_discount > 0 ? '−'.$money($item->line_discount) : '—' }}</td>
                        @endif
                        <td class="r num b">{{ $money($item->line_total) }}</td>
                    @endunless
                </tr>
            @endforeach
            </tbody>
        </table>
    @endif

    {{-- ══ Totals ════════════════════════════════════════════════ --}}
    @unless($gift)
        <hr class="rule">
        <table class="totals">
            <tr><td class="soft">Subtotal</td><td class="num">{{ $cur }} {{ $money($sale->subtotal) }}</td></tr>

            @if((float) $sale->promo_discount > 0)
                <tr>
                    <td class="soft">{{ $sale->promo_name ?: 'Promotion' }}</td>
                    <td class="num">− {{ $cur }} {{ $money($sale->promo_discount) }}</td>
                </tr>
            @endif
            @if((float) $sale->discount > 0)
                <tr>
                    <td class="soft">Discount{{ $sale->coupon_code ? ' ('.$sale->coupon_code.')' : '' }}</td>
                    <td class="num">− {{ $cur }} {{ $money($sale->discount) }}</td>
                </tr>
            @endif

            @if($taxed)
                <tr>
                    {{-- Inclusive tax is already inside the line prices: showing
                         it as an addition would double-count it on the paper. --}}
                    <td class="soft">{{ $sale->tax_inclusive ? 'Sales tax (included)' : 'Sales tax' }}</td>
                    <td class="num">{{ $sale->tax_inclusive ? '' : '+ ' }}{{ $cur }} {{ $money($sale->tax) }}</td>
                </tr>
            @endif

            <tr class="grand"><td>Total</td><td class="num">{{ $cur }} {{ $money($sale->total) }}</td></tr>

            {{-- A tip sits BELOW the total on purpose: it is not part of the
                 bill, and a customer disputing the charge needs to see the two
                 figures separately. --}}
            @if((float) ($sale->tip_amount ?? 0) > 0)
                <tr class="tender change"><td>Tip</td><td class="num">{{ $cur }} {{ $money($sale->tip_amount) }}</td></tr>
            @endif

            {{-- Every tender, not just the headline method: a split payment that
                 prints as one line is unreconcilable at the end of the day. --}}
            @if($payments->count() > 0)
                @foreach($payments as $p)
                    <tr class="tender">
                        <td>{{ $methodLabel[$p->method] ?? ucfirst(str_replace('_', ' ', (string) $p->method)) }}{{ $p->reference ? ' · '.$p->reference : '' }}</td>
                        <td class="num">{{ $cur }} {{ $money($p->amount) }}</td>
                    </tr>
                @endforeach
            @else
                <tr class="tender">
                    <td>{{ $methodLabel[$sale->payment_method?->value] ?? 'Paid' }}</td>
                    <td class="num">{{ $cur }} {{ $money($sale->amount_paid) }}</td>
                </tr>
            @endif

            @if((float) $sale->change_due > 0)
                <tr class="tender change"><td>Change</td><td class="num">{{ $cur }} {{ $money($sale->change_due) }}</td></tr>
            @endif

            @php($due = round((float) $sale->total - (float) $sale->amount_paid, 2))
            @if($due > 0)
                <tr class="tender change"><td>Balance due</td><td class="num">{{ $cur }} {{ $money($due) }}</td></tr>
            @endif
        </table>

        @if($anyDiscount)
            <div class="lmeta {{ $roll ? '' : 'r' }}" style="margin-top:6px">
                You saved {{ $cur }} {{ $money($lineDiscounts + (float) $sale->discount + (float) $sale->promo_discount) }}
            </div>
        @endif
    @endunless

    {{-- ══ Serialized units ══════════════════════════════════════ --}}
    @if($serials->count() > 0)
        <hr class="rule">
        <div class="lmeta b" style="margin-bottom:4px">Serial numbers</div>
        <table class="items" style="font-size:{{ $roll ? '11px' : '12px' }}">
            @foreach($serials as $s)
                <tr>
                    <td>{{ $s->product_name }}<div class="lmeta num">{{ $s->serial }}</div></td>
                    <td class="r lmeta">
                        @if($s->warranty_expires_at)
                            Warranty to {{ $s->warranty_expires_at->format('d M Y') }}
                        @else
                            No warranty
                        @endif
                    </td>
                </tr>
            @endforeach
        </table>
    @endif

    {{-- ══ Loyalty ═══════════════════════════════════════════════ --}}
    @if(! $gift && ((int) $sale->points_earned > 0 || (int) $sale->points_redeemed > 0))
        <hr class="hair">
        <div class="lmeta">
            @if((int) $sale->points_redeemed > 0){{ number_format($sale->points_redeemed) }} points redeemed. @endif
            @if((int) $sale->points_earned > 0){{ number_format($sale->points_earned) }} points earned on this purchase.@endif
        </div>
    @endif

    @if($sale->notes)
        <hr class="hair">
        <div class="lmeta">{{ $sale->notes }}</div>
    @endif

    {{-- ══ Footer ════════════════════════════════════════════════ --}}
    <hr class="rule">

    @if($roll)
        <div class="c foot">
            @if(!empty($settings['invoice_footer']))
                <div>{{ $settings['invoice_footer'] }}</div>
            @endif
            @if($fbr)
                <div class="taxids" style="margin-top:6px">Verify this invoice with FBR · POS {{ $fbr }}</div>
            @endif
            <div class="taxids" style="margin-top:6px">{{ $sale->invoice_number }}</div>
        </div>
    @else
        <div class="foot">
            @if(!empty($settings['invoice_footer']))
                <div class="c">{{ $settings['invoice_footer'] }}</div>
            @endif
            @if($fbr)
                <div class="c taxids" style="margin-top:4px">Verify this invoice with FBR · POS {{ $fbr }}</div>
            @endif
            <div class="sign">
                <div>Customer signature</div>
                <div class="r">For {{ $tenant->business_name }}</div>
            </div>
        </div>
    @endif

    @if($preview)
        <div class="c taxids" style="margin-top:14px">Sample data — preview only</div>
    @endif
</div>
</body>
</html>
