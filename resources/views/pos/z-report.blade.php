{{--
    The Z-read: the paper record of a counted drawer.

    Every figure here comes off the FROZEN session row, never recomputed. A
    Z-read reprinted next year has to match the slip that was signed that
    night — even if a sale on it has since been voided or refunded. A report
    that changes retroactively is not evidence of anything, and this is the
    document a shop reaches for when a shift is disputed.

    Two things printed the way a counter reads them:

      THE DENOMINATION COUNT  listed largest first, the order it was taken in,
                              with each row's own subtotal. That is what makes
                              a re-count possible — a bare total isn't checkable
                              by anyone.
      THE VARIANCE            given its own block, signed, and never buried in
                              a column. It is the only line on here that starts
                              a conversation.

    Under blind close the cashier signs having never seen `expected`. The slip
    still prints it, because by the time this comes off the printer the count
    is submitted and the number is no longer something they can count towards.
--}}
@php
    $width  = $paper ?? ($settings['receipt_width'] ?? 'thermal_80');
    $roll   = in_array($width, ['thermal_58', 'thermal_80'], true);
    $rollMm = $width === 'thermal_58' ? '48mm' : '72mm';

    $cur   = $settings['currency_symbol'] ?? 'Rs';
    $money = fn ($n) => number_format((float) $n, 2);

    $variance   = (float) $session->variance;
    $over       = $variance > 0.001;
    $short      = $variance < -0.001;
    $balanced   = ! $over && ! $short;

    $denoms   = $session->closing_denominations ?? [];
    $declared = $session->declared_tenders ?? [];
    $tenderVar = $session->tender_variances ?? [];

    $methodLabel = [
        'cash' => 'Cash', 'card' => 'Card', 'bank_transfer' => 'Bank transfer',
        'credit' => 'Khata / credit', 'deposit' => 'Advance', 'other' => 'Other',
    ];
@endphp
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Z-Read {{ $session->id }}</title>
<style>
    @page { size: {{ $roll ? $rollMm.' auto' : 'A4' }}; margin: {{ $roll ? '3mm' : '14mm' }}; }
    * { box-sizing: border-box; }
    body {
        font-family: {{ $roll ? "'Courier New', monospace" : "-apple-system, 'Segoe UI', Roboto, sans-serif" }};
        color: #000; background: #fff; margin: 0;
        font-size: {{ $roll ? '11px' : '13px' }};
        line-height: 1.45;
        {{ $roll ? '' : 'max-width: 190mm; margin: 0 auto;' }}
    }
    h1 { font-size: {{ $roll ? '14px' : '20px' }}; margin: 0 0 2px; letter-spacing: .04em; }
    .muted { color: #555; }
    .center { text-align: center; }
    .right { text-align: right; }
    .rule { border-top: 1px dashed #000; margin: 8px 0; }
    .solid { border-top: 1px solid #000; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 1px 0; vertical-align: top; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .section { margin-top: 10px; }
    .section-title {
        text-transform: uppercase; letter-spacing: .08em;
        font-size: {{ $roll ? '10px' : '11px' }}; font-weight: 700;
        margin-bottom: 3px;
    }
    .total td { font-weight: 700; padding-top: 3px; }
    .variance {
        margin-top: 10px; padding: 6px 8px; text-align: center;
        border: 2px solid #000;
    }
    .variance .figure { font-size: {{ $roll ? '16px' : '22px' }}; font-weight: 700; }
    .sign { margin-top: 18px; }
    .sign-line { border-top: 1px solid #000; width: 60%; margin-top: 26px; padding-top: 3px; }
</style>
</head>
<body>

<div class="center">
    <h1>{{ $settings['invoice_header'] ?? ($tenant->business_name ?? 'Shop') }}</h1>
    <div class="muted">END OF SHIFT — Z READ</div>
</div>

<div class="rule"></div>

<table>
    <tr><td>Shift</td><td class="num">{{ strtoupper(substr($session->id, 0, 8)) }}</td></tr>
    @if ($session->register)
        <tr><td>Register</td><td class="num">{{ $session->register->name }}</td></tr>
    @endif
    @if ($session->branch)
        <tr><td>Branch</td><td class="num">{{ $session->branch->name }}</td></tr>
    @endif
    <tr><td>Cashier</td><td class="num">{{ $session->user->name ?? '—' }}</td></tr>
    @if ($closedBy && $closedBy !== ($session->user->name ?? null))
        {{-- A manager force-closing a lane someone walked away from is a
             different event, and the variance means something different. --}}
        <tr><td>Closed by</td><td class="num">{{ $closedBy }}</td></tr>
    @endif
    <tr><td>Opened</td><td class="num">{{ $session->opened_at?->format('d M Y, H:i') }}</td></tr>
    <tr><td>Closed</td><td class="num">{{ $session->closed_at?->format('d M Y, H:i') }}</td></tr>
    @if ($session->blind_close)
        <tr><td colspan="2" class="muted">Counted blind</td></tr>
    @endif
</table>

<div class="section">
    <div class="section-title">Trading</div>
    <table>
        <tr><td>Sales</td><td class="num">{{ (int) $session->sales_count }}</td></tr>
        <tr><td>Sales total</td><td class="num">{{ $cur }} {{ $money($session->sales_total) }}</td></tr>
    </table>
</div>

<div class="section">
    <div class="section-title">Drawer</div>
    <table>
        <tr><td>Opening float</td><td class="num">{{ $money($session->opening_float) }}</td></tr>
        <tr><td>Cash sales</td><td class="num">{{ $money($session->cash_sales) }}</td></tr>
        <tr><td>Paid in</td><td class="num">{{ $money($session->cash_in) }}</td></tr>
        <tr><td>Paid out</td><td class="num">−{{ $money($session->cash_out) }}</td></tr>
        <tr class="total"><td>Expected</td><td class="num">{{ $cur }} {{ $money($session->expected_cash) }}</td></tr>
        <tr class="total"><td>Counted</td><td class="num">{{ $cur }} {{ $money($session->counted_cash) }}</td></tr>
    </table>
</div>

@if (! empty($denoms))
    {{-- The count as it was taken. A bare total is not checkable by anyone;
         these rows are what let a second person re-count the drawer. --}}
    <div class="section">
        <div class="section-title">Counted by denomination</div>
        <table>
            @foreach ($denoms as $value => $qty)
                <tr>
                    <td>{{ $cur }} {{ number_format((int) $value) }} × {{ (int) $qty }}</td>
                    <td class="num">{{ $money((int) $value * (int) $qty) }}</td>
                </tr>
            @endforeach
            <tr class="total">
                <td>Total counted</td>
                <td class="num">{{ $money($session->counted_cash) }}</td>
            </tr>
        </table>
    </div>
@endif

<div class="variance">
    <div>{{ $balanced ? 'DRAWER BALANCED' : ($over ? 'OVER' : 'SHORT') }}</div>
    @unless ($balanced)
        <div class="figure">{{ $cur }} {{ $money(abs($variance)) }}</div>
    @endunless
</div>

@if (! empty($declared))
    <div class="section">
        <div class="section-title">Declared tenders</div>
        <table>
            @foreach ($declared as $method => $amount)
                @php $diff = (float) ($tenderVar[$method] ?? 0); @endphp
                <tr>
                    <td>{{ $methodLabel[$method] ?? ucfirst(str_replace('_', ' ', $method)) }}</td>
                    <td class="num">
                        {{ $money($amount) }}
                        @if (abs($diff) > 0.001)
                            ({{ $diff > 0 ? '+' : '−' }}{{ $money(abs($diff)) }})
                        @endif
                    </td>
                </tr>
            @endforeach
        </table>
    </div>
@endif

@if ($movements->isNotEmpty())
    <div class="section">
        <div class="section-title">Cash movements</div>
        <table>
            @foreach ($movements as $m)
                @if ($m->direction !== 'none')
                    <tr>
                        <td>
                            {{ ucfirst(str_replace('_', ' ', $m->type)) }}
                            @if ($m->reason)<span class="muted"> · {{ $m->reason }}</span>@endif
                        </td>
                        <td class="num">{{ $m->direction === 'out' ? '−' : '' }}{{ $money($m->amount) }}</td>
                    </tr>
                @endif
            @endforeach
        </table>
    </div>
@endif

{{-- Who else stood at this drawer. On the paper slip because that is the
     version that gets signed, and "I wasn't even here for that hour" has to be
     answerable from the same sheet as the variance. --}}
@if (! empty($covers))
    <div class="section">
        <div class="section-title">Covered by</div>
        <table>
            @foreach ($covers as $c)
                <tr>
                    <td>
                        {{ $c['user_name'] ?? 'Unknown' }}
                        <span class="muted">
                            · {{ \Illuminate\Support\Carbon::parse($c['started_at'])->format('H:i') }}–{{ $c['ended_at'] ? \Illuminate\Support\Carbon::parse($c['ended_at'])->format('H:i') : '…' }}
                        </span>
                        @if ($c['reason'])<span class="muted"> · {{ $c['reason'] }}</span>@endif
                    </td>
                    <td class="num">{{ $c['sales_count'] }} sale{{ $c['sales_count'] === 1 ? '' : 's' }} · {{ $money($c['cash_taken']) }}</td>
                </tr>
            @endforeach
        </table>
    </div>
@endif

@if ($session->notes)
    <div class="section">
        <div class="section-title">Notes</div>
        <div>{{ $session->notes }}</div>
    </div>
@endif

<div class="solid"></div>

<div class="sign">
    {{-- An unsigned Z-read is worth what the person holding it says it's
         worth, which is the whole reason a disputed shift goes badly. --}}
    <div class="sign-line">Cashier</div>
    <div class="sign-line">Verified by</div>
</div>

<script>window.onload = () => window.print();</script>
</body>
</html>
