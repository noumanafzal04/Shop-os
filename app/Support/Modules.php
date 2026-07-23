<?php

namespace App\Support;

/**
 * Manageable tenant modules — the capability flags a Super Admin can toggle
 * per tenant. These are the same keys stored in tenants.features and enforced
 * by Tenant::featureEnabled() throughout the app, surfaced here with
 * human-friendly labels for the admin Module Management screen.
 */
class Modules
{
    /** @return array<string, array{label: string, description: string}> */
    public static function all(): array
    {
        return [
            'pos' => ['label' => 'Point of Sale (POS)', 'description' => 'In-shop till: scan, sell, print receipts, shifts. Works offline. Off for online-only shops.'],
            'products' => ['label' => 'Products', 'description' => 'Sell physical products / menu items.'],
            'services' => ['label' => 'Services', 'description' => 'Offer services (salon, workshop, repair).'],
            'inventory' => ['label' => 'Inventory', 'description' => 'Stock tracking, adjustments, low-stock alerts.'],
            'marketplace' => ['label' => 'Marketplace', 'description' => 'List the shop + take online orders (needs an online plan).'],
            'reservations' => ['label' => 'Reservations', 'description' => 'Customers reserve items to collect.'],
            'delivery' => ['label' => 'Delivery', 'description' => 'Delivery fulfilment on online orders.'],
            'dine_in' => ['label' => 'Dine-in / Restaurant', 'description' => 'Tables, running tabs, kitchen tickets (KOT), and split-bill. For restaurants & cafés.'],
            'expenses' => ['label' => 'Expense Manager', 'description' => 'Track business expenses & categories (optional — a sell-only shop can skip it).'],
            'images' => ['label' => 'Product Images', 'description' => 'Upload photos for products. Always on when selling online; optional for walk-in-only shops.'],
        ];
    }

    public static function keys(): array
    {
        return array_keys(self::all());
    }
}
