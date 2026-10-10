{{--
    "Bill please." What a table owes, before it pays.

    NOT a receipt and not an invoice: no invoice number, no tenders, no
    cashier, nothing that says money has changed hands — because it has not,
    and a slip that looked like a receipt would be one in a customer's hand.
    It says so at the top and at the bottom.

    The figures are TabBill's: the sale path's own rule for a tab, so this
    paper and the invoice that follows it agree to the paisa.
--}}
@php
    $width  = $settings['receipt_width'] ?? 'thermal_80';
    $roll   = in_array($width, ['thermal_58', 'thermal_80'], true);
    $column = $width === 'thermal_58' ? '48mm' : '72mm';
    $cur    = $settings['currency_symbol'] ?? 'Rs';
    $money  = fn ($n) => number_format((float) $n, 2);
    // 2.000 reads wrong on a bill; 2 does. Real fractions are kept.
    $qty    = fn ($n) => rtrim(rtrim(number_format((float) $n, 3, '.', ''), '0'), '.') ?: '0';
    // A takeaway has no table to be called by; it is called by who is waiting for it.
    $guest  = trim((string) ($ticket->customer_name ?? ''));
    $where  = $ticket->order_type === 'takeaway'
        ? ($guest !== '' ? "Takeaway · {$guest}" : 'Takeaway')
        : ($ticket->table?->name ?? $ticket->ticket_number);
@endphp
<!DOCTYPE html>
<html lang="en" {!! \App\Support\PrintPaper::htmlAttributes($width) !!}>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Bill — {{ $where }} — {{ $ticket->ticket_number }}</title>
    <style>
        /* Black on white, no fills: a thermal head renders grey as mush. */
        * { box-sizing: border-box; }
        body {
            font-family: "Courier New", ui-monospace, monospace;
            margin: 0 auto;
            padding: {{ $roll ? \App\Support\PrintPaper::rollEdge() : '12mm' }};
            color: #000;
            width: {{ $roll ? ($width === 'thermal_58' ? '58mm' : '80mm') : '100mm' }};
            font-size: {{ $width === 'thermal_58' ? '12px' : '13px' }};
            line-height: 1.4;
        }
        .center { text-align: center; }
        .shop { font-size: 17px; font-weight: 800; }
        .title { font-size: 20px; font-weight: 900; letter-spacing: 3px; margin-top: 4px; }
        .not { font-size: 11px; font-weight: 700; letter-spacing: 1px; }
        .rule { border-top: 1px dashed #000; margin: 7px 0; }
        .row { display: flex; justify-content: space-between; gap: 8px; }
        .row > :last-child { text-align: right; white-space: nowrap; }
        .soft { font-size: 11px; }
        .item { margin: 0 0 6px; }
        .item .sub { padding-left: 14px; font-size: 11px; }
        .total { font-size: 19px; font-weight: 900; }
        @media print {
            body { width: auto; }
            @page { size: {{ \App\Support\PrintPaper::pageSize($width) }}; margin: {{ \App\Support\PrintPaper::pageMargin($width, '12mm') }}; }
        }
    </style>
</head>
{{-- No `onload="window.print()"`: it is printed through the panel's one print
     door, which fits the page to the paper first. A slip that printed itself
     printed twice. --}}
<body>
    <div class="center">
        <div class="shop">{{ $tenant?->business_name }}</div>
        @if (!empty($tenant?->phone))
            <div class="soft">{{ $tenant->phone }}</div>
        @endif
        <div class="title">BILL</div>
        <div class="not">NOT A RECEIPT</div>
    </div>

    <div class="rule"></div>

    <div class="row"><span>{{ $ticket->order_type === 'takeaway' ? 'Order' : 'Table' }}</span><span><strong>{{ $where }}</strong></span></div>
    <div class="row soft"><span>Tab</span><span>{{ $ticket->ticket_number }}</span></div>
    @if ($ticket->waiter)
        <div class="row soft"><span>Served by</span><span>{{ $ticket->waiter->name }}</span></div>
    @endif
    @if ((int) $ticket->guest_count > 0)
        <div class="row soft"><span>Guests</span><span>{{ (int) $ticket->guest_count }}</span></div>
    @endif
    {{-- The shop's clock, not the server's: a bill timed five hours out is a
         bill somebody argues with. --}}
    <div class="row soft"><span>Printed</span><span>{{ \App\Support\ShopTime::show(now(), 'd M Y · h:i A', $tenant) }}</span></div>

    <div class="rule"></div>

    @foreach ($bill['lines'] as $line)
        <div class="item">
            <div class="row">
                <span>{{ $qty($line['quantity']) }} × {{ $line['name'] }}</span>
                <span>{{ $money($line['line_total']) }}</span>
            </div>
            @if ($line['detail'] !== '')
                <div class="sub">{{ $line['detail'] }}</div>
            @endif
            @foreach ($line['modifiers'] as $modifier)
                <div class="sub">+ {{ $modifier }}</div>
            @endforeach
            @if ($line['line_discount'] > 0)
                <div class="sub">less {{ $money($line['line_discount']) }}</div>
            @endif
        </div>
    @endforeach

    <div class="rule"></div>

    <div class="row"><span>Subtotal</span><span>{{ $cur }} {{ $money($bill['subtotal']) }}</span></div>
    @if ($bill['tax'] > 0)
        <div class="row"><span>Tax</span><span>+ {{ $cur }} {{ $money($bill['tax']) }}</span></div>
    @endif
    <div class="row total"><span>TO PAY</span><span>{{ $cur }} {{ $money($bill['total']) }}</span></div>

    @if ($bill['paid_earlier'] > 0)
        <div class="rule"></div>
        {{-- A table that split: what was paid for earlier is on its own
             invoice, and saying nothing would read as items left off. --}}
        <div class="soft center">{{ $bill['paid_earlier'] }} {{ $bill['paid_earlier'] === 1 ? 'item' : 'items' }} on this table {{ $bill['paid_earlier'] === 1 ? 'was' : 'were' }} paid for earlier and {{ $bill['paid_earlier'] === 1 ? 'is' : 'are' }} not on this bill.</div>
    @endif

    <div class="rule"></div>
    <div class="center not">THIS IS NOT A RECEIPT</div>
    <div class="center soft">Your receipt is printed when the bill is paid.</div>
</body>
</html>
