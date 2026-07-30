<?php

namespace App\Support;

/**
 * Tenant configuration registry — the single source of truth for shop
 * settings, their defaults, and validation. Stored in tenants.settings (JSON);
 * a tenant's effective config is defaults() merged with what they've saved.
 */
class ShopSettings
{
    /** @return array<string, mixed> */
    public static function defaults(): array
    {
        return [
            // General
            'currency' => 'PKR',
            'currency_symbol' => 'Rs',
            'language' => 'en',
            'default_tax_rate' => 0,        // percent, applied at POS/checkout

            // Service businesses (salon/workshop): coverage area shown on the storefront
            'service_area' => null,

            // ── Order fulfillment (per business): pickup / delivery / both ──
            // Modes: pickup-only (electronics, garments) · delivery-only
            // (cloud kitchens) · both (restaurants, groceries — recommended).
            // Delivery additionally requires the business-type `delivery`
            // feature flag — see Tenant::deliveryEnabled().
            'pickup_enabled' => true,
            'delivery_enabled' => true,
            // Who carries deliveries: 'self' = the shop's own riders (Model A,
            // available now) · 'platform' = the ShopOS rider pool (coming soon).
            'delivery_provider' => 'self',
            'prep_time_minutes' => null,   // estimated prep / handover time
            'delivery_radius_km' => null,  // null = no distance limit (city-wide)
            'min_order_amount' => null,    // delivery orders below this are rejected
            'free_delivery_threshold' => null, // subtotal at/above → delivery fee waived

            // Invoice / receipt
            'invoice_header' => null,       // extra line under the shop name
            'invoice_footer' => 'Thank you for your business!',
            'invoice_show_logo' => true,
            'receipt_width' => 'standard',  // standard | thermal_80 | thermal_58

            // POS
            'pos_default_payment' => 'cash', // cash | card
            'pos_auto_print' => false,
            'pos_require_shift' => true,

            // ── Loyalty & rewards ───────────────────────────────────────
            // Customers earn points on completed sales and redeem them as a
            // counter discount. Off by default. earn_per_amount = the spend (in
            // Rs) that earns 1 point; redeem_value = the Rs each point is worth
            // when redeemed; min_redeem = points needed before any redemption.
            'loyalty_enabled' => false,
            'loyalty_earn_per_amount' => 100,  // 1 point per Rs 100 spent
            'loyalty_redeem_value' => 1,       // 1 point = Rs 1
            'loyalty_min_redeem' => 100,       // must have ≥100 pts to redeem

            // Barcode labels
            'barcode_show_price' => true,
            'barcode_show_name' => true,

            // ── Scale (embedded-weight) barcodes ────────────────────────
            // Grocery/deli scales print in-store EAN-13s that carry a PLU
            // code + the weighed value. Off by default (only groceries that
            // weigh loose items need it). See App\Support\ScaleBarcode.
            'scale_barcode_enabled' => false,
            'scale_barcode_prefix' => '2',       // flag digits: "2" or "20"–"29"
            'scale_barcode_mode' => 'weight',    // weight | price (what the label embeds)
        ];
    }

    /** Validation rules for an incoming settings update (all optional). */
    public static function rules(): array
    {
        return [
            'currency' => ['sometimes', 'string', 'size:3'],
            'currency_symbol' => ['sometimes', 'string', 'max:5'],
            'language' => ['sometimes', 'string', 'max:5'],
            'default_tax_rate' => ['sometimes', 'numeric', 'min:0', 'max:100'],
            'service_area' => ['sometimes', 'nullable', 'string', 'max:300'],
            'pickup_enabled' => ['sometimes', 'boolean'],
            'delivery_enabled' => ['sometimes', 'boolean'],
            'delivery_provider' => ['sometimes', 'in:self,platform'],
            'prep_time_minutes' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:480'],
            'delivery_radius_km' => ['sometimes', 'nullable', 'numeric', 'min:0.5', 'max:100'],
            'min_order_amount' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'free_delivery_threshold' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'invoice_header' => ['sometimes', 'nullable', 'string', 'max:200'],
            'invoice_footer' => ['sometimes', 'nullable', 'string', 'max:300'],
            'invoice_show_logo' => ['sometimes', 'boolean'],
            'receipt_width' => ['sometimes', 'in:standard,thermal_80,thermal_58'],
            'pos_default_payment' => ['sometimes', 'in:cash,card'],
            'pos_auto_print' => ['sometimes', 'boolean'],
            'pos_require_shift' => ['sometimes', 'boolean'],
            'loyalty_enabled' => ['sometimes', 'boolean'],
            'loyalty_earn_per_amount' => ['sometimes', 'numeric', 'min:1', 'max:1000000'],
            'loyalty_redeem_value' => ['sometimes', 'numeric', 'min:0.01', 'max:100000'],
            'loyalty_min_redeem' => ['sometimes', 'integer', 'min:0', 'max:1000000'],
            'barcode_show_price' => ['sometimes', 'boolean'],
            'barcode_show_name' => ['sometimes', 'boolean'],
            'scale_barcode_enabled' => ['sometimes', 'boolean'],
            'scale_barcode_prefix' => ['sometimes', 'string', 'regex:/^\d{1,2}$/'],
            'scale_barcode_mode' => ['sometimes', 'in:weight,price'],
        ];
    }
}
