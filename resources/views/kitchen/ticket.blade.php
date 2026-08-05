<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    {{-- Station in the title too: several KOTs from one fire print back to
         back, and the print dialog is all the operator sees of each. --}}
    <title>KOT #{{ $kot->kot_number }} {{ $kot->station ? strtoupper($kot->station).' ' : '' }}— {{ $ticket->ticket_number }}</title>
    <style>
        /* Kitchen ticket — thermal (80mm) friendly, big and price-free. */
        * { box-sizing: border-box; }
        body {
            font-family: "Courier New", ui-monospace, monospace;
            margin: 0;
            padding: 10px 12px;
            color: #000;
            width: 80mm;
            font-size: 15px;
            line-height: 1.35;
        }
        .center { text-align: center; }
        .big { font-size: 20px; font-weight: 700; }
        /* The station is the whole point of the ticket: a KOT read at the
           wrong section is food cooked late or not at all. It gets the
           largest type on the paper and the first thing the eye lands on. */
        .station {
            font-size: 34px;
            font-weight: 900;
            line-height: 1.1;
            letter-spacing: 1px;
            text-transform: uppercase;
            border: 3px solid #000;
            padding: 4px 2px;
            margin-top: 2px;
            word-break: break-word;
        }
        .rule { border-top: 2px dashed #000; margin: 8px 0; }
        .row { display: flex; justify-content: space-between; gap: 8px; }
        .muted { font-size: 12px; }
        ul { list-style: none; margin: 0; padding: 0; }
        li { margin: 0 0 10px; }
        .qty { font-weight: 800; }
        .mods { padding-left: 14px; font-size: 13px; }
        .mods li { margin: 0; }
        .note { padding-left: 14px; font-size: 13px; font-weight: 700; text-transform: uppercase; }
        @media print {
            body { width: auto; }
            @page { margin: 4mm; }
        }
    </style>
</head>
<body onload="window.print()">
    <div class="center">
        {{-- Nothing prints above the station, not even the shop name — this is
             the one line that decides whether the food gets cooked at all. No
             station configured = a one-printer kitchen, so "KITCHEN" stands in
             rather than a section that doesn't exist. --}}
        <div class="station">{{ $kot->station ?: 'KITCHEN' }}</div>
        @if (!empty($shopName))
            <div class="muted">{{ $shopName }}</div>
        @endif
    </div>

    <div class="rule"></div>

    <div class="row big">
        <span>KOT #{{ $kot->kot_number }}</span>
        <span>
            @if ($ticket->order_type === 'takeaway')
                TAKEAWAY
            @elseif ($ticket->table)
                {{ $ticket->table->name }}
            @else
                {{ $ticket->ticket_number }}
            @endif
        </span>
    </div>
    <div class="row muted">
        <span>{{ $ticket->ticket_number }}</span>
        <span>{{ optional($kot->fired_at)->format('d M, H:i') }}</span>
    </div>

    <div class="rule"></div>

    <ul>
        @foreach ($kot->items as $item)
            <li>
                <div class="row">
                    <span class="big">
                        <span class="qty">{{ rtrim(rtrim(number_format((float) $item->quantity, 3), '0'), '.') }}×</span>
                        {{ $item->product_name }}
                    </span>
                </div>
                @if ($item->variant_name || $item->unit_name)
                    <div class="mods">{{ trim($item->variant_name.' '.$item->unit_name) }}</div>
                @endif
                @if (!empty($item->modifiers))
                    <ul class="mods">
                        @foreach ($item->modifiers as $mod)
                            <li>+ {{ $mod['name'] ?? '' }}</li>
                        @endforeach
                    </ul>
                @endif
                @if (!empty($item->note))
                    <div class="note">** {{ $item->note }}</div>
                @endif
            </li>
        @endforeach
    </ul>

    @if (!empty($kot->notes))
        <div class="rule"></div>
        <div class="note">** {{ $kot->notes }}</div>
    @endif
</body>
</html>
