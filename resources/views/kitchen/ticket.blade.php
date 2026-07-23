<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>KOT #{{ $kot->kot_number }} — {{ $ticket->ticket_number }}</title>
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
        .huge { font-size: 24px; font-weight: 800; }
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
        @if (!empty($shopName))
            <div class="muted">{{ $shopName }}</div>
        @endif
        <div class="huge">KITCHEN</div>
        @if (!empty($kot->station))
            <div class="big">{{ $kot->station }}</div>
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
