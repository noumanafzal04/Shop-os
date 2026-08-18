<?php

namespace App\Services;

use App\Enums\SaleStatus;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;

/**
 * Global search — the ⌘K command palette's backend. One query fans out across
 * the tenant's products, customers, sales, orders and suppliers, returning a
 * small ranked slice of each. Every group is gated by the SAME permission +
 * feature rules as its own page, so staff only ever see what they may open;
 * the frontend maps each result's `type` to a route.
 */
class GlobalSearchService
{
    /** Rows returned per group — enough to find the thing, few enough to stay a palette. */
    private const PER_GROUP = 6;

    /**
     * @return array{query: string, total: int, groups: array<int, array{type: string, label: string, items: array}>}
     */
    public function search(Tenant $tenant, User $user, string $query): array
    {
        $q = trim($query);

        // Two characters is the floor — a single letter matches everything and
        // isn't a search. Return an empty, well-formed envelope below that.
        if (mb_strlen($q) < 2) {
            return ['query' => $q, 'total' => 0, 'groups' => []];
        }

        $groups = [];

        // Each group asks whether this person may READ that thing, not whether
        // they may edit it. Asking the write question here quietly deleted the
        // Products section from the search box for every cashier and waiter in
        // the shop — the search still worked, it just never found a product.
        if ($user->hasAnyPermission(Permissions::READS_CATALOG)) {
            $groups[] = $this->group('product', 'Products', $this->products($q));
        }

        if ($user->hasPermission(Permissions::CUSTOMERS_MANAGE)) {
            $groups[] = $this->group('customer', 'Customers', $this->customers($q));
        }

        if ($user->hasPermission(Permissions::SALES_MANAGE)) {
            $groups[] = $this->group('sale', 'Sales', $this->sales($q));
        }

        // Orders only exist for a shop that sells online.
        if ($user->hasPermission(Permissions::ORDERS_MANAGE) && $tenant->featureEnabled('marketplace')) {
            $groups[] = $this->group('order', 'Orders', $this->orders($q));
        }

        if ($user->hasAnyPermission(Permissions::READS_SUPPLIERS)) {
            $groups[] = $this->group('supplier', 'Suppliers', $this->suppliers($q));
        }

        // Drop groups the user can access but that matched nothing — the palette
        // shows only sections with hits.
        $groups = array_values(array_filter($groups, fn ($g) => $g['items'] !== []));

        return [
            'query' => $q,
            'total' => array_sum(array_map(fn ($g) => count($g['items']), $groups)),
            'groups' => $groups,
        ];
    }

    /** @param array<int, array> $items */
    private function group(string $type, string $label, array $items): array
    {
        return ['type' => $type, 'label' => $label, 'items' => $items];
    }

    private function products(string $q): array
    {
        $like = "%{$q}%";

        return Product::query()
            ->where(fn ($w) => $w
                ->where('name', 'like', $like)
                ->orWhere('sku', 'like', $like)
                ->orWhere('barcode', 'like', $like)
                ->orWhere('plu_code', 'like', $like))
            ->orderByRaw('CASE WHEN name like ? THEN 0 ELSE 1 END', ["{$q}%"]) // prefix hits first
            ->orderBy('name')
            ->limit(self::PER_GROUP)
            ->get(['id', 'name', 'sku', 'price', 'item_type', 'stock_quantity', 'track_inventory'])
            ->map(fn (Product $p) => [
                'id' => $p->id,
                'name' => $p->name,
                'sku' => $p->sku,
                'price' => $p->price,
                'item_type' => $p->item_type,
                'stock_quantity' => $p->track_inventory ? $p->stock_quantity : null,
            ])
            ->all();
    }

    private function customers(string $q): array
    {
        $like = "%{$q}%";

        return Customer::query()
            ->where(fn ($w) => $w
                ->where('name', 'like', $like)
                ->orWhere('phone', 'like', $like)
                ->orWhere('email', 'like', $like))
            ->orderByRaw('CASE WHEN name like ? THEN 0 ELSE 1 END', ["{$q}%"])
            ->orderByDesc('last_seen_at')
            ->limit(self::PER_GROUP)
            ->get(['id', 'name', 'phone', 'credit_balance'])
            ->map(fn (Customer $c) => [
                'id' => $c->id,
                'name' => $c->name,
                'phone' => $c->phone,
                'credit_balance' => $c->credit_balance,
            ])
            ->all();
    }

    private function sales(string $q): array
    {
        return Sale::query()
            ->where('status', '!=', SaleStatus::Cancelled->value)
            // Shared with the sales ledger and its export, so a slip number
            // found in one place is found in all three.
            ->matchingSearch($q)
            ->orderByDesc('sold_at')
            ->limit(self::PER_GROUP)
            ->get(['id', 'invoice_number', 'offline_number', 'customer_name', 'total', 'status', 'sold_at'])
            ->map(fn (Sale $s) => [
                'id' => $s->id,
                'invoice_number' => $s->invoice_number,
                // Carried so the person holding the slip can see their own
                // number on the row they are about to open. Finding the sale
                // and not being able to confirm it is the same sale is half a
                // fix.
                'offline_number' => $s->offline_number,
                'customer_name' => $s->customer_name,
                'total' => $s->total,
                'status' => $s->status,
                'sold_at' => $s->sold_at,
            ])
            ->all();
    }

    private function orders(string $q): array
    {
        $like = "%{$q}%";

        return Order::query()
            ->where(fn ($w) => $w
                ->where('order_number', 'like', $like)
                ->orWhere('customer_name', 'like', $like)
                ->orWhere('customer_phone', 'like', $like))
            ->orderByDesc('placed_at')
            ->limit(self::PER_GROUP)
            ->get(['id', 'order_number', 'customer_name', 'total', 'status', 'placed_at'])
            ->map(fn (Order $o) => [
                'id' => $o->id,
                'order_number' => $o->order_number,
                'customer_name' => $o->customer_name,
                'total' => $o->total,
                'status' => $o->status,
                'placed_at' => $o->placed_at,
            ])
            ->all();
    }

    private function suppliers(string $q): array
    {
        $like = "%{$q}%";

        return Supplier::query()
            ->where(fn ($w) => $w
                ->where('name', 'like', $like)
                ->orWhere('contact_person', 'like', $like)
                ->orWhere('phone', 'like', $like)
                ->orWhere('email', 'like', $like))
            ->orderBy('name')
            ->limit(self::PER_GROUP)
            ->get(['id', 'name', 'contact_person', 'phone'])
            ->map(fn (Supplier $s) => [
                'id' => $s->id,
                'name' => $s->name,
                'contact_person' => $s->contact_person,
                'phone' => $s->phone,
            ])
            ->all();
    }
}
