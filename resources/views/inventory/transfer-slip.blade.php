{{--
    A transfer slip — what left one place for another, to travel with it.

    The driver carries it, and the person at the other end counts against it:
    so every line has a box to write what actually arrived, and the foot has
    two names — who sent it and who took it in. Until it is received those
    boxes are empty on purpose. Once it has been, the slip prints what was
    counted, and says plainly where less arrived than left.

    No prices: it is a count of goods, and a slip that travels with a van is
    read by people who have no business knowing what the cartons cost.
--}}
@php
    $width = $settings['receipt_width'] ?? 'thermal_80';
    $roll  = in_array($width, ['thermal_58', 'thermal_80'], true);
    // 2.000 reads wrong on a slip; 2 does. Real fractions are kept.
    $qty   = fn ($n) => rtrim(rtrim(number_format((float) $n, 3, '.', ''), '0'), '.') ?: '0';
    $counted = $transfer->received_at !== null;
    $state = match ($transfer->status) {
        \App\Models\StockTransfer::REQUESTED => 'ASKED FOR — NOT SENT',
        \App\Models\StockTransfer::IN_TRANSIT => 'ON ITS WAY',
        \App\Models\StockTransfer::SHORT => 'RECEIVED SHORT',
        \App\Models\StockTransfer::CANCELLED => 'CALLED BACK',
        default => 'RECEIVED',
    };
    $what = fn (string $kind) => $kind === \App\Models\Branch::KIND_WAREHOUSE ? 'Warehouse' : 'Shop';
@endphp
<!DOCTYPE html>
<html lang="en" {!! \App\Support\PrintPaper::htmlAttributes($width) !!}>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Transfer {{ $transfer->reference }}</title>
    <style>
        /* Black on white, no fills: a thermal head renders grey as mush. */
        * { box-sizing: border-box; }
        body {
            font-family: "Courier New", ui-monospace, monospace;
            margin: 0 auto;
            padding: {{ $roll ? \App\Support\PrintPaper::rollEdge() : '12mm' }};
            color: #000;
            width: {{ $roll ? ($width === 'thermal_58' ? '58mm' : '80mm') : '180mm' }};
            font-size: {{ $width === 'thermal_58' ? '12px' : '13px' }};
            line-height: 1.4;
        }
        .center { text-align: center; }
        .shop { font-size: 17px; font-weight: 800; }
        .title { font-size: 18px; font-weight: 900; letter-spacing: 2px; margin-top: 4px; }
        .state { font-size: 11px; font-weight: 700; letter-spacing: 1px; }
        .rule { border-top: 1px dashed #000; margin: 7px 0; }
        .row { display: flex; justify-content: space-between; gap: 8px; }
        .row > :last-child { text-align: right; }
        .soft { font-size: 11px; }
        .item { margin: 0 0 7px; }
        .item .sub { padding-left: 14px; font-size: 11px; }
        .box { display: inline-block; min-width: 16mm; border-bottom: 1px solid #000; text-align: center; }
        .sign { margin-top: 14px; }
        .sign .line { border-bottom: 1px solid #000; height: 9mm; }
        @media print {
            body { width: auto; }
            @page { size: {{ \App\Support\PrintPaper::pageSize($width) }}; margin: {{ \App\Support\PrintPaper::pageMargin($width, '12mm') }}; }
        }
    </style>
</head>
{{-- No `onload="window.print()"`: it is printed through the panel's one print
     door, which fits the page to the paper first. --}}
<body>
    <div class="center">
        <div class="shop">{{ $tenant?->business_name }}</div>
        <div class="title">STOCK TRANSFER</div>
        <div class="state">{{ $state }}</div>
    </div>

    <div class="rule"></div>

    <div class="row"><span>Transfer</span><span><strong>{{ $transfer->reference }}</strong></span></div>
    <div class="row"><span>From</span><span><strong>{{ $transfer->fromBranch?->name }}</strong> <span class="soft">({{ $what($transfer->fromBranch?->kind ?? 'shop') }})</span></span></div>
    <div class="row"><span>To</span><span><strong>{{ $transfer->toBranch?->name }}</strong> <span class="soft">({{ $what($transfer->toBranch?->kind ?? 'shop') }})</span></span></div>
    {{-- The shop's clock, not the server's. --}}
    @if ($transfer->sent_at)
        <div class="row soft"><span>Sent</span><span>{{ \App\Support\ShopTime::show($transfer->sent_at, 'd M Y · h:i A', $tenant) }}</span></div>
    @else
        <div class="row soft"><span>Asked</span><span>{{ \App\Support\ShopTime::show($transfer->created_at, 'd M Y · h:i A', $tenant) }}</span></div>
    @endif
    @if ($counted)
        <div class="row soft"><span>Received</span><span>{{ \App\Support\ShopTime::show($transfer->received_at, 'd M Y · h:i A', $tenant) }}</span></div>
    @endif
    @if (!empty($transfer->notes))
        <div class="soft">Note: {{ $transfer->notes }}</div>
    @endif

    <div class="rule"></div>

    <div class="row soft"><span>ITEM</span><span>{{ $transfer->sent_at ? 'SENT' : 'ASKED FOR' }} · {{ $counted ? 'RECEIVED' : 'RECEIVED (write in)' }}</span></div>
    <div class="rule"></div>

    @foreach ($transfer->items as $item)
        <div class="item">
            <div class="row">
                <span>{{ $item->product_name }}@if ($item->variant_name) — {{ $item->variant_name }}@endif</span>
                <span>
                    <strong>{{ $qty($item->quantity) }}</strong> ·
                    @if ($counted)
                        <strong>{{ $qty($item->quantity_received) }}</strong>
                    @else
                        <span class="box">&nbsp;</span>
                    @endif
                </span>
            </div>
            @foreach ($item->lots ?? [] as $lot)
                <div class="sub">Batch {{ $lot['batch_number'] }}@if (!empty($lot['expiry_date'])) · exp {{ \App\Support\ShopTime::day($lot['expiry_date'], $tenant ?? null) }}@endif · {{ $qty($lot['quantity']) }}</div>
            @endforeach
            @if ($counted && $item->short() > 0)
                <div class="sub"><strong>{{ $qty($item->short()) }} did not arrive</strong> — {{ $item->short_reason === 'damaged' ? 'damaged' : 'missing' }}@if ($item->short_outcome === 'returned'), put back at {{ $transfer->fromBranch?->name }}@elseif ($item->short_outcome === 'written_off'), written off @else, not yet settled @endif</div>
            @endif
        </div>
    @endforeach

    <div class="rule"></div>

    <div class="row"><span>Lines</span><span>{{ $transfer->items->count() }}</span></div>
    <div class="row"><span>Units {{ $transfer->sent_at ? 'sent' : 'asked for' }}</span><span><strong>{{ $qty($transfer->items->sum('quantity')) }}</strong></span></div>
    @if ($counted)
        <div class="row"><span>Units received</span><span><strong>{{ $qty($transfer->items->sum('quantity_received')) }}</strong></span></div>
    @endif

    <div class="sign">
        @if ($transfer->requester && $transfer->requester->id !== $transfer->sender?->id)
            <div class="row soft"><span>Asked for by</span><span>{{ $transfer->requester->name }}</span></div>
        @endif
        <div class="row soft"><span>Sent by</span><span>{{ $transfer->sender?->name }}</span></div>
        <div class="line"></div>
        <div class="row soft" style="margin-top: 10px;"><span>Received by</span><span>{{ $transfer->receiver?->name }}</span></div>
        <div class="line"></div>
    </div>
</body>
</html>
