<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{{ $sale->invoice_number }} — {{ $tenant->business_name }}</title>
    <style>
        * { box-sizing: border-box; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; }
        body { margin: 0; padding: 32px; color: #101828; font-size: 14px; }
        .invoice { max-width: 640px; margin: 0 auto; }
        .head { display: flex; justify-content: space-between; margin-bottom: 24px; }
        h1 { font-size: 20px; margin: 0 0 4px; }
        .muted { color: #667085; font-size: 12px; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px;
                 background: #ecfdf3; color: #027a48; }
        .badge.cancelled { background: #fef3f2; color: #b42318; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        th { text-align: left; font-size: 11px; text-transform: uppercase; color: #667085;
             border-bottom: 1px solid #e4e7ec; padding: 8px 4px; }
        td { padding: 8px 4px; border-bottom: 1px solid #f2f4f7; }
        .num { text-align: right; }
        .totals { margin-left: auto; width: 240px; }
        .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
        .totals .grand { font-weight: 700; font-size: 16px; border-top: 1px solid #e4e7ec; padding-top: 8px; }
        .footer { margin-top: 32px; text-align: center; }
        @media print { body { padding: 0; } .no-print { display: none; } }
    </style>
</head>
<body>
@php($cur = $settings['currency_symbol'] ?? 'Rs')
<div class="invoice">
    <div class="head">
        <div>
            @if(($settings['invoice_show_logo'] ?? true) && $tenant->logo_path)
                <img src="{{ \Illuminate\Support\Facades\Storage::disk('public')->url($tenant->logo_path) }}" alt="" style="max-height:56px;margin-bottom:8px">
            @endif
            <h1>{{ $tenant->business_name }}</h1>
            @if(!empty($settings['invoice_header']))<div class="muted">{{ $settings['invoice_header'] }}</div>@endif
            @if($tenant->address)<div class="muted">{{ $tenant->address }}</div>@endif
            @if($tenant->phone)<div class="muted">{{ $tenant->phone }}</div>@endif
        </div>
        <div style="text-align:right">
            <h1>{{ $sale->invoice_number }}</h1>
            <div class="muted">{{ $sale->sold_at->format('d M Y, h:i A') }}</div>
            <span class="badge {{ $sale->isCancelled() ? 'cancelled' : '' }}">{{ $sale->status->value }}</span>
        </div>
    </div>

    @if($sale->customer_name || $sale->customer_phone)
        <div class="muted">
            Customer: {{ $sale->customer_name }} {{ $sale->customer_phone ? '· '.$sale->customer_phone : '' }}
        </div>
    @endif

    @if($sale->prescription_number || $sale->prescriber_name || $sale->patient_name)
        <div class="muted">
            ℞ Prescription:
            {{ $sale->prescription_number ? '#'.$sale->prescription_number : '' }}
            {{ $sale->patient_name ? '· Patient: '.$sale->patient_name : '' }}
            {{ $sale->prescriber_name ? '· Dr. '.$sale->prescriber_name : '' }}
        </div>
    @endif

    <table>
        <thead>
        <tr>
            <th>Item</th>
            <th class="num">Qty</th>
            <th class="num">Price</th>
            <th class="num">Total</th>
        </tr>
        </thead>
        <tbody>
        @foreach($sale->items as $item)
            <tr>
                <td>
                    {{ $item->product_name }}
                    @if($item->variant_name) <span class="muted">({{ $item->variant_name }})</span>@endif
                    @if($item->unit_name) <span class="muted">— {{ $item->unit_name }}</span>@endif
                    @if($item->sku)<div class="muted">SKU {{ $item->sku }}</div>@endif
                </td>
                <td class="num">{{ $item->quantity }}</td>
                <td class="num">{{ $cur }} {{ number_format((float) $item->unit_price, 2) }}</td>
                <td class="num">{{ $cur }} {{ number_format((float) $item->line_total, 2) }}</td>
            </tr>
        @endforeach
        </tbody>
    </table>

    <div class="totals">
        <div><span>Subtotal</span><span>{{ $cur }} {{ number_format((float) $sale->subtotal, 2) }}</span></div>
        @if((float) $sale->discount > 0)
            <div><span>Discount</span><span>-{{ $cur }} {{ number_format((float) $sale->discount, 2) }}</span></div>
        @endif
        @if((float) $sale->tax > 0)
            <div><span>Tax</span><span>{{ $cur }} {{ number_format((float) $sale->tax, 2) }}</span></div>
        @endif
        <div class="grand"><span>Total</span><span>{{ $cur }} {{ number_format((float) $sale->total, 2) }}</span></div>
        <div><span>Paid ({{ $sale->payment_method->value }})</span><span>{{ $cur }} {{ number_format((float) $sale->amount_paid, 2) }}</span></div>
        @if((float) $sale->change_due > 0)
            <div><span>Change</span><span>{{ $cur }} {{ number_format((float) $sale->change_due, 2) }}</span></div>
        @endif
    </div>

    <div class="footer muted">{{ $settings['invoice_footer'] ?? 'Thank you for your business!' }}</div>
    <div class="footer no-print">
        <button onclick="window.print()" style="padding:8px 24px;cursor:pointer">Print</button>
    </div>
</div>
</body>
</html>
