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
            // Tax mode. false (default) = EXCLUSIVE: tax is added on top of the
            // price at checkout. true = INCLUSIVE: prices already contain tax
            // (common for PKR retail) — the receipt shows the tax portion held
            // WITHIN the price and the total is not inflated by it.
            'tax_inclusive' => false,

            // ── Appearance / branding ───────────────────────────────────
            // A tenant can wear its own colours. NULL means "use the ShopOS
            // default" (brand blue #465FFF) — we never store the default, so a
            // future rebrand of the product follows automatically for everyone
            // who hasn't chosen. The primary drives the whole brand ramp
            // (buttons, active nav, POS accents) in BOTH light and dark; the
            // secondary is an optional supporting accent. Semantic colours
            // (success/warning/error) are deliberately NOT themeable — green
            // must keep meaning "good" no matter the brand.
            'theme_primary' => null,    // #RRGGBB
            'theme_secondary' => null,  // #RRGGBB
            // How strongly the brand hue carries into the neutral surfaces
            // (page background, cards, borders): none = plain grey,
            // subtle = a designed hint, strong = unmistakably branded.
            'theme_tint' => 'subtle',   // none | subtle | strong
            // The sidebar's surface. 'dark' keeps a dark rail even in light
            // mode — the look most POS/admin products ship with.
            'theme_sidebar' => 'light', // light | tinted | dark

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
            // Who served you — the receipt is the customer's copy of the audit
            // trail, and a complaint about a sale is useless without the lane
            // and the cashier on the slip.
            'receipt_show_cashier' => true,
            // ── Tax identifiers (Pakistan) ──────────────────────────────
            // NTN = National Tax Number, STRN = Sales Tax Registration Number.
            // A registered shop must show these on a tax invoice; an
            // unregistered one has neither, so both are null by default and
            // simply do not print. fbr_pos_id is the FBR POS registration a
            // Tier-1 retailer is issued — we PRINT it, we do not transmit to
            // FBR (that needs the shop's own FBR credentials and their API).
            'invoice_ntn' => null,
            'invoice_strn' => null,
            'invoice_fbr_pos_id' => null,

            // POS
            'pos_default_payment' => 'cash', // cash | card
            'pos_auto_print' => false,
            // Try to kick the cash drawer open when a sale is tendered in cash.
            // Only possible where the drawer (or the printer it hangs off) is
            // reachable over a direct transport — see HardwareDevice. On a
            // plain browser print there is no kick and the POS says so rather
            // than pretending.
            'pos_drawer_kick' => true,
            // Lock the till after this many idle minutes, so the next sale is
            // stamped with whoever actually rang it rather than whoever opened
            // up. 0 = never. Ships OFF: a one-person shop being asked for a PIN
            // between customers is a worse problem than the one it solves, and
            // nobody has a PIN yet on the day this ships.
            'pos_idle_lock_minutes' => 0,

            // ── Kitchen (food service) ──────────────────────────────────
            // The sections a fired order can be routed to. Empty = no routing:
            // one "fire" makes one KOT, which is right for a small kitchen with
            // a single printer and wrong the moment a bar exists.
            'kitchen_stations' => [],
            // Print the KOT the moment it's fired. On by default — a kitchen
            // ticket that isn't printed hasn't been sent, whatever the screen
            // says. A shop running a kitchen SCREEN instead turns this off.
            'kot_auto_print' => true,
            // Ask for a tip when settling a tab. Off by default: tipping is not
            // universal, and a prompt that isn't wanted slows every bill.
            'tips_enabled' => false,
            // Refuse a counter sale unless the cashier has a shift open, so
            // every rupee belongs to a drawer that gets counted. Ships OFF: the
            // flag existed for months while nothing read it, so turning it on
            // by default would suddenly stop a one-person shop from selling.
            // Recommended ON for any shop with staff or more than one lane.
            'pos_require_shift' => false,

            // Discount authority. The DISCRETIONARY discount a cashier keys —
            // whole-bill plus hand-keyed line discounts — is capped by these;
            // going past one needs the discounts.override permission. Coupons,
            // promotions, group pricing and loyalty are exempt: those are rules
            // the owner configured, not a judgement call at the counter.
            // Null = no ceiling, which is the shipped default because the
            // control never existed before and capping by surprise would stop
            // shops from selling.
            'max_discount_percent' => null,
            'max_discount_amount' => null,

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
            'tax_inclusive' => ['sometimes', 'boolean'],
            // Hex only, 6 digits, with the hash — the panel turns this into a
            // full 25→950 ramp client-side, so anything else would silently
            // produce an unreadable UI.
            'theme_primary' => ['sometimes', 'nullable', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'theme_secondary' => ['sometimes', 'nullable', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'theme_tint' => ['sometimes', 'in:none,subtle,strong'],
            'theme_sidebar' => ['sometimes', 'in:light,tinted,dark'],
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
            'receipt_show_cashier' => ['sometimes', 'boolean'],
            'invoice_ntn' => ['sometimes', 'nullable', 'string', 'max:30'],
            'invoice_strn' => ['sometimes', 'nullable', 'string', 'max:30'],
            'invoice_fbr_pos_id' => ['sometimes', 'nullable', 'string', 'max:30'],
            'pos_default_payment' => ['sometimes', 'in:cash,card'],
            'pos_auto_print' => ['sometimes', 'boolean'],
            'pos_drawer_kick' => ['sometimes', 'boolean'],
            'pos_idle_lock_minutes' => ['sometimes', 'integer', 'min:0', 'max:240'],
            'kitchen_stations' => ['sometimes', 'array', 'max:12'],
            'kitchen_stations.*' => ['string', 'max:40'],
            'kot_auto_print' => ['sometimes', 'boolean'],
            'tips_enabled' => ['sometimes', 'boolean'],
            'pos_require_shift' => ['sometimes', 'boolean'],
            'max_discount_percent' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:100'],
            'max_discount_amount' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:99999999'],
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
