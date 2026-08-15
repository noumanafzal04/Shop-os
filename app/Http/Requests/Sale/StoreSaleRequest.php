<?php

namespace App\Http\Requests\Sale;

use App\Enums\SaleChannel;
use App\Rules\OwnOpenShift;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreSaleRequest extends FormRequest
{
    public function authorize(): bool
    {
        if (! $this->user()->hasPermission(Permissions::SALES_MANAGE)) {
            return false;
        }

        // Any discount is a controlled action — a cashier needs discounts.apply
        // to hand one out (owners pass this too).
        //
        // The whole-bill discount used to slip through here entirely: only the
        // per-LINE fields were inspected, so a cashier with plain sales.manage
        // could key Rs 5,000 off a Rs 5,200 bill and nothing stopped them. The
        // permission model looked like it governed discounts while governing
        // half of them.
        $hasLineDiscount = collect($this->input('items', []))->contains(
            fn ($i) => (float) ($i['line_discount'] ?? 0) > 0 || (float) ($i['line_discount_pct'] ?? 0) > 0,
        );
        $hasCartDiscount = (float) $this->input('discount', 0) > 0;

        return ! ($hasLineDiscount || $hasCartDiscount)
            || $this->user()->hasPermission(Permissions::DISCOUNTS_APPLY);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'channel' => ['required', Rule::enum(SaleChannel::class)],
            'customer_name' => ['nullable', 'string', 'max:255'],
            'customer_phone' => ['nullable', 'string', 'max:32'],
            'order_type' => ['nullable', 'in:dine_in,takeaway'],
            'table_no' => ['nullable', 'string', 'max:16'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => [
                'required', 'uuid',
                Rule::exists('products', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'items.*.variant_id' => ['nullable', 'uuid'],
            // Pack-breaking: sell this line in a defined pack (strip/box). The
            // pack must belong to the line's product (checked in the action).
            'items.*.product_unit_id' => ['nullable', 'uuid'],
            // Price level (price list): the cashier picks retail/wholesale; the
            // server prices from the product's own stored figure for that level.
            'items.*.price_level' => ['nullable', 'in:retail,wholesale'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001', 'max:100000'],
            // NOTE: no items.*.unit_price — pricing is server-authoritative.
            // Anything a client sends is dropped by validated().
            // Per-line discount: a fixed amount OR a percentage. The server
            // computes/validates it against its own line price (a client can
            // never dictate the final line price, only the discount off it).
            'items.*.line_discount' => ['nullable', 'numeric', 'min:0'],
            'items.*.line_discount_pct' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'items.*.modifier_option_ids' => ['sometimes', 'array', 'max:50'],
            'items.*.modifier_option_ids.*' => ['uuid'],
            // Serialized retail: one serial/IMEI per unit sold on this line, and
            // an optional warranty override (months) that beats the product's
            // default. Serials are data, never pricing — safe from clients.
            // Pharmacy: how to take THIS medicine, per line. Like serials it
            // is data about the dispensing, never pricing, so a client may
            // send it. Printed on the receipt/label and kept on the sale.
            'items.*.directions' => ['nullable', 'string', 'max:255'],
            'items.*.serials' => ['sometimes', 'array', 'max:1000'],
            'items.*.serials.*' => ['string', 'max:120', 'distinct'],
            'items.*.warranty_months' => ['nullable', 'integer', 'min:0', 'max:600'],
            'discount' => ['nullable', 'numeric', 'min:0'],
            'coupon_code' => ['nullable', 'string', 'max:40'],
            // Loyalty: points the customer spends on this sale (converted to a
            // discount server-side at the shop's redeem_value). A count, never a
            // price — safe from the client. Needs a linked customer.
            'redeem_points' => ['nullable', 'integer', 'min:0'],
            // NOTE: no `tax` — tax is server-authoritative, computed from each
            // product's tax rate (see CreateSaleAction). Anything a client sends
            // is dropped by validated().
            // Single tender: payment_method + amount_paid (required unless the
            // sale is split — 'split' is server-only, never a client tender).
            // 'credit' = sell-on-credit (khata) — the amount goes onto the
            // customer's balance (needs a linked customer; enforced in the action).
            'payment_method' => ['required_without:payments', 'in:cash,card,bank_transfer,other,credit'],
            'amount_paid' => ['required_without:payments', 'numeric', 'min:0'],
            // Multi-tender / split payment: part cash + part card (+ part credit)
            // etc. When present it overrides the single tender above; amount_paid
            // becomes the sum of tenders.
            'payments' => ['nullable', 'array', 'max:10'],
            'payments.*.method' => ['required_with:payments', 'in:cash,card,bank_transfer,other,credit'],
            'payments.*.amount' => ['required_with:payments', 'numeric', 'min:0.01'],
            'payments.*.reference' => ['nullable', 'string', 'max:100'],

            // Goods taken in part-payment — the dead battery, the worn tyres.
            // Note what is NOT here: an amount. The allowance is quantity ×
            // unit_allowance, computed server-side, and `trade_in` is not an
            // accepted tender method above. A client that could name its own
            // trade-in amount could settle any bill with nothing changing hands.
            'trade_ins' => ['nullable', 'array', 'max:10'],
            'trade_ins.*.product_id' => ['required_with:trade_ins', 'uuid'],
            'trade_ins.*.quantity' => ['nullable', 'numeric', 'min:0.001', 'max:9999'],
            'trade_ins.*.unit_allowance' => ['required_with:trade_ins', 'numeric', 'min:0', 'max:9999999'],
            'trade_ins.*.description' => ['nullable', 'string', 'max:255'],
            'trade_ins.*.notes' => ['nullable', 'string', 'max:500'],

            // The vehicle this work was done on, and the reading at the time.
            // A tyre shop's real customer key: what a warranty claim hangs off
            // and what a service reminder is counted from.
            // Scoped to THIS shop, like `product_id` above and for the same
            // reason. Unscoped it was not an exposure — every read of a
            // vehicle's history goes through the tenant scope, so another
            // shop's car could never show anyone else's work — but it let a
            // sale store a pointer that resolves to nothing for ever, and a
            // record that renders as a blank where a car should be is a bug
            // somebody debugs a year later.
            'vehicle_id' => [
                'nullable',
                'uuid',
                Rule::exists('customer_vehicles', 'id')->where('tenant_id', $tenantId),
            ],
            'odometer' => ['nullable', 'integer', 'min:0', 'max:9999999'],

            // ── A bank funding part of its own card's transaction ────
            //
            // The shop names the BANK and the server works out the money. No
            // discount, percentage or offer value is accepted from here, for
            // the same reason `unit_price` is not: from HTTP it would be a
            // "give me any discount I like" field.
            'bank_id' => [
                'nullable',
                'uuid',
                Rule::exists('banks', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            // Some deals are credit-only, so the offer needs to know.
            'card_type' => ['nullable', 'in:credit,debit'],
            // FOUR DIGITS, and the rule is the fence rather than a formatting
            // nicety. A full card number in this database puts the shop and
            // this platform inside PCI DSS — an audit regime, not a setting —
            // and it is the kind of column that ends a company when a database
            // leaks. `digits:4` refuses sixteen outright rather than quietly
            // storing them and trimming later.
            'card_last4' => ['nullable', 'digits:4'],

            // A tip rides on top of the bill: it raises what must be paid and
            // what the drawer should hold, and never touches revenue.
            'tip_amount' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:999999'],
            'notes' => ['nullable', 'string', 'max:1000'],
            // Pharmacy: prescription record for a sale of Rx-required medicine.
            // Optional at the API (never hard-blocks a sale); the POS prompts
            // for it whenever the basket holds an Rx item.
            'prescription_number' => ['nullable', 'string', 'max:100'],
            'prescriber_name' => ['nullable', 'string', 'max:255'],
            'patient_name' => ['nullable', 'string', 'max:255'],
            'prescription_notes' => ['nullable', 'string', 'max:1000'],
            'idempotency_key' => ['nullable', 'string', 'max:64'],
            'cash_session_id' => [
                'nullable', 'uuid',
                new OwnOpenShift($this->user()),
            ],
        ];
    }
}
