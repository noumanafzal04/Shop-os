<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    @php($width = $settings['receipt_width'] ?? 'standard')
    @php($thermal = in_array($width, ['thermal_58', 'thermal_80'], true))
    {{-- Roll width for a thermal printer: 58mm ≈ 48mm printable, 80mm ≈ 72mm. --}}
    @php($paperMm = $width === 'thermal_58' ? '58mm' : ($width === 'thermal_80' ? '80mm' : 'auto'))
    @php($rollMm = $width === 'thermal_58' ? '48mm' : ($width === 'thermal_80' ? '72mm' : '640px'))
    <title>{{ $sale->invoice_number }} — {{ $tenant->business_name }}</title>
    <style>
        * { box-sizing: border-box; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; }
        body { margin: 0; padding: {{ $thermal ? '6px' : '32px' }}; color: #101828; font-size: {{ $thermal ? '12px' : '14px' }}; }
        .invoice { width: {{ $rollMm }}; max-width: 100%; margin: 0 auto; }
        /* Thermal rolls are narrow — stack the header instead of two columns. */
        .head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: {{ $thermal ? '10px' : '24px' }}; {{ $thermal ? 'flex-direction: column;' : '' }} }
        .head > div:last-child { text-align: {{ $thermal ? 'left' : 'right' }}; }
        h1 { font-size: {{ $thermal ? '14px' : '20px' }}; margin: 0 0 4px; }
        .muted { color: #667085; font-size: {{ $thermal ? '11px' : '12px' }}; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px;
                 background: #ecfdf3; color: #027a48; }
        .badge.cancelled { background: #fef3f2; color: #b42318; }
        table { width: 100%; border-collapse: collapse; margin: {{ $thermal ? '8px 0' : '16px 0' }}; }
        th { text-align: left; font-size: 11px; text-transform: uppercase; color: #667085;
             border-bottom: 1px solid #e4e7ec; padding: {{ $thermal ? '4px 2px' : '8px 4px' }}; }
        td { padding: {{ $thermal ? '4px 2px' : '8px 4px' }}; border-bottom: 1px solid #f2f4f7; }
        .num { text-align: right; }
        .totals { margin-left: auto; width: {{ $thermal ? '100%' : '240px' }}; }
        .totals div { display: flex; justify-content: space-between; padding: {{ $thermal ? '2px 0' : '4px 0' }}; }
        .totals .grand { font-weight: 700; font-size: {{ $thermal ? '14px' : '16px' }}; border-top: 1px solid #e4e7ec; padding-top: 8px; }
        .footer { margin-top: {{ $thermal ? '14px' : '32px' }}; text-align: center; }
        @media print {
            body { padding: 0; }
            .no-print { display: none; }
            @page { size: {{ $paperMm === 'auto' ? 'auto' : $paperMm.' auto' }}; margin: {{ $thermal ? '0' : '12mm' }}; }
        }
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
