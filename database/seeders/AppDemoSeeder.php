<?php

namespace Database\Seeders;

use App\Models\Announcement;
use App\Models\Banner;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Review;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Storage;

/**
 * App-perfect demo data: everything the CUSTOMER APP showcases —
 * business hours (open/closed), reviews (ratings + top-rated), sale
 * prices, weight items, wholesale tiers, pharmacy batches, placeholder
 * product/banner images (GD), live orders in every status, announcements.
 * Runs after DemoDataSeeder; assumes a fresh seed.
 */
class AppDemoSeeder extends Seeder
{
    public function run(): void
    {
        $tenants = Tenant::query()->whereNotNull('city_id')->orderBy('business_name')->get();
        $customers = User::query()->where('role', 'customer')->orderBy('email')->get();
        if ($tenants->isEmpty() || $customers->isEmpty()) {
            return;
        }

        $this->command?->info('AppDemoSeeder: hours, reviews, pricing flavors, images, orders…');

        foreach ($tenants as $i => $tenant) {
            $this->seedHoursAndSettings($tenant);
            $this->seedReviews($tenant, $customers, $i);
            $this->seedPricingFlavors($tenant);
            $this->seedImages($tenant);
        }

        $this->seedBanners($tenants);
        $this->seedOrders($tenants, $customers);
        $this->seedAnnouncements();
    }

    // ── Business hours + shop settings ──────────────────────────────
    private function seedHoursAndSettings(Tenant $tenant): void
    {
        $hours = match ($tenant->business_type) {
            'restaurant' => $this->week('11:00', '23:30'),
            'pharmacy' => $this->week('08:00', '23:59'),
            // One deliberately "closed now" shop demos the Closed badge:
            'books' => $this->week('03:00', '04:00'),
            default => $this->week('09:00', '22:00'),
        };

        $settings = $tenant->settings ?? [];

        // Order-fulfillment demo spread: restaurants/groceries = both (with
        // delivery economics), retail/books = pickup-only, others = default.
        if ($tenant->business_type === 'restaurant') {
            $settings['prep_time_minutes'] = 25;
            $settings['delivery_radius_km'] = 8;
            $settings['min_order_amount'] = 500;
            $settings['free_delivery_threshold'] = 3000;
        }
        if ($tenant->business_type === 'grocery') {
            $settings['delivery_radius_km'] = 6;
            $settings['min_order_amount'] = 300;
            $settings['free_delivery_threshold'] = 2500;
        }
        if (in_array($tenant->business_type, ['retail', 'books', 'hardware'], true)) {
            $settings['pickup_enabled'] = true;
            $settings['delivery_enabled'] = false; // pickup-only shops
        }

        $tenant->update(['business_hours' => $hours, 'settings' => $settings]);
    }

    private function week(string $open, string $close): array
    {
        return collect(range(0, 6))
            ->map(fn (int $d) => ['day' => $d, 'open' => $open, 'close' => $close])
            ->all();
    }

    // ── Reviews: ratings power the Top-rated section ────────────────
    private function seedReviews(Tenant $tenant, $customers, int $seed): void
    {
        $comments = [
            'Great quality, will order again!',
            'Fast and exactly as described.',
            'Decent, but delivery took a while.',
            'Absolutely loved it. Highly recommended.',
            'Good prices compared to others nearby.',
            'Fresh and well packed.',
        ];

        $count = 3 + ($seed % 3); // 3..5 reviews per shop
        for ($j = 0; $j < $count && $j < $customers->count(); $j++) {
            $customer = $customers[($seed + $j) % $customers->count()];
            Review::withoutTenancy()->firstOrCreate(
                ['tenant_id' => $tenant->id, 'customer_id' => $customer->id],
                [
                    'rating' => 3 + (($seed + $j * 2) % 3), // 3..5
                    'comment' => $comments[($seed + $j) % count($comments)],
                    'is_published' => true,
                    'reply' => $j === 0 ? 'Thank you for your support!' : null,
                    'replied_at' => $j === 0 ? now()->subDays(2) : null,
                ],
            );
        }
    }

    // ── Pricing flavors per business type ───────────────────────────
    private function seedPricingFlavors(Tenant $tenant): void
    {
        $products = Product::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('type', 'product')
            ->orderBy('name')
            ->get();
        if ($products->isEmpty()) {
            return;
        }

        // SALE: ~15% off the two priciest items (strikethrough demo).
        foreach ($products->sortByDesc('price')->take(2) as $p) {
            $p->update(['discount_price' => round((float) $p->price * 0.85, 2)]);
        }

        // WEIGHT: loose items sold by kg/metre — fractions like 1.5 kg work.
        $looseByType = [
            'grocery' => [['Sugar (loose)', 'kg', 190], ['Basmati Rice (loose)', 'kg', 320], ['Fresh Tomatoes', 'kg', 120]],
            'hardware' => [['Electric Cable 7/29', 'm', 95], ['Steel Chain', 'm', 260]],
        ];
        foreach ($looseByType[$tenant->business_type] ?? [] as [$name, $unit, $price]) {
            Product::withoutTenancy()->firstOrCreate(
                ['tenant_id' => $tenant->id, 'name' => $name],
                [
                    'type' => 'product', 'item_type' => 'physical_product',
                    'unit' => $unit, 'sold_by' => 'weight', 'price' => $price,
                    'cost' => round($price * 0.7, 2), 'stock_quantity' => 250.5,
                    'low_stock_threshold' => 10, 'track_inventory' => true,
                ],
            );
        }

        // WHOLESALE: qty breaks + minimum order.
        if ($tenant->business_type === 'wholesale') {
            foreach ($products as $p) {
                $price = (float) $p->price;
                $p->update([
                    'price_tiers' => [
                        ['min_qty' => 10, 'price' => round($price * 0.9, 2)],
                        ['min_qty' => 50, 'price' => round($price * 0.8, 2)],
                    ],
                    'min_order_qty' => 6,
                ]);
            }
        }

        // PHARMACY: batch/lot tracking with one near-expiry lot.
        if ($tenant->business_type === 'pharmacy') {
            foreach ($products->take(4) as $k => $p) {
                if ((float) $p->stock_quantity <= 0 || $p->batches()->exists()) {
                    continue;
                }
                $stock = (float) $p->stock_quantity;
                $near = round($stock * 0.3, 3);
                ProductBatch::withoutTenancy()->create([
                    'tenant_id' => $tenant->id, 'product_id' => $p->id,
                    'batch_number' => 'LOT-24'.(100 + $k), 'quantity' => $near,
                    'expiry_date' => now()->addDays(12 + $k * 3)->toDateString(),
                ]);
                ProductBatch::withoutTenancy()->create([
                    'tenant_id' => $tenant->id, 'product_id' => $p->id,
                    'batch_number' => 'LOT-25'.(100 + $k), 'quantity' => round($stock - $near, 3),
                    'expiry_date' => now()->addMonths(14)->toDateString(),
                ]);
            }
        }
    }

    // ── Placeholder images (GD) — products get real pictures later ──
    private function seedImages(Tenant $tenant): void
    {
        $palette = [[59, 183, 126], [16, 26, 38], [244, 162, 97], [42, 111, 151], [155, 93, 229], [214, 40, 40]];

        $products = Product::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->orderBy('name')
            ->take(4)
            ->get();

        foreach ($products as $k => $p) {
            if ($p->images()->exists()) {
                continue;
            }
            [$r, $g, $b] = $palette[($k + strlen($p->name)) % count($palette)];
            $path = "products/demo-{$p->id}.png";
            Storage::disk('public')->put($path, $this->placeholderPng(600, 400, $r, $g, $b, $p->name));
            $p->images()->create(['tenant_id' => $tenant->id, 'path' => $path, 'sort_order' => 0]);
        }
    }

    private function placeholderPng(int $w, int $h, int $r, int $g, int $b, string $label): string
    {
        $im = imagecreatetruecolor($w, $h);
        $bg = imagecolorallocate($im, $r, $g, $b);
        imagefilledrectangle($im, 0, 0, $w, $h, $bg);
        // Soft diagonal band for a bit of depth (still flat-looking).
        $band = imagecolorallocatealpha($im, 255, 255, 255, 100);
        imagefilledpolygon($im, [0, $h, $w, (int) ($h * 0.55), $w, $h], $band);
        $fg = imagecolorallocate($im, 255, 255, 255);
        $text = mb_substr($label, 0, 22);
        imagestring($im, 5, 16, 16, $text, $fg);
        ob_start();
        imagepng($im);
        imagedestroy($im);

        return (string) ob_get_clean();
    }

    // ── Home banners (paid ads) ─────────────────────────────────────
    private function seedBanners($tenants): void
    {
        if (Banner::query()->exists()) {
            return;
        }
        $picks = [
            [$tenants->firstWhere('business_type', 'restaurant'), 'Hot & fresh — 20% off family deals 🍕', [214, 40, 40]],
            [$tenants->firstWhere('business_type', 'grocery'), 'Fresh groceries, delivered in minutes 🥬', [59, 183, 126]],
        ];
        foreach ($picks as $i => [$shop, $title, [$r, $g, $b]]) {
            if ($shop === null) {
                continue;
            }
            $path = "banners/demo-{$i}.png";
            Storage::disk('public')->put($path, $this->placeholderPng(1200, 480, $r, $g, $b, $title));
            Banner::query()->create([
                'tenant_id' => $shop->id, 'title' => $title, 'image_path' => $path,
                'target_type' => 'shop', 'placement' => 'home', 'sort_order' => $i,
                'is_active' => true, 'amount' => 5000, 'paid_at' => now(),
            ]);
        }
    }

    // ── Live orders for user1 — every tracking status ───────────────
    private function seedOrders($tenants, $customers): void
    {
        $buyer = $customers->first();
        $shops = $tenants->filter(fn (Tenant $t) => $t->online_shop_enabled)->values();
        $statuses = [
            ['completed', 'delivery', now()->subDays(3)],
            ['out_for_delivery', 'delivery', now()->subMinutes(35)],
            ['preparing', 'delivery', now()->subMinutes(12)],
            ['pending', 'pickup', now()->subMinutes(3)],
        ];

        foreach ($statuses as $i => [$status, $fulfillment, $placedAt]) {
            $shop = $shops[$i % max($shops->count(), 1)] ?? null;
            if ($shop === null) {
                continue;
            }
            $product = Product::withoutTenancy()
                ->where('tenant_id', $shop->id)->where('type', 'product')
                ->orderBy('name')->first();
            if ($product === null) {
                continue;
            }

            $orderNo = 'ORD-90'.str_pad((string) ($i + 1), 2, '0', STR_PAD_LEFT);
            if (Order::withoutTenancy()->where('tenant_id', $shop->id)->where('order_number', $orderNo)->exists()) {
                continue;
            }

            $qty = 2;
            $unit = (float) $product->price;
            $subtotal = round($unit * $qty, 2);
            $fee = $fulfillment === 'delivery' ? (float) $shop->delivery_fee : 0;

            $order = Order::withoutTenancy()->create([
                'tenant_id' => $shop->id, 'customer_id' => $buyer->id,
                'order_number' => $orderNo, 'status' => $status,
                'fulfillment_type' => $fulfillment, 'payment_method' => 'cod',
                'payment_status' => $status === 'completed' ? 'paid' : 'unpaid',
                'customer_name' => $buyer->name, 'customer_phone' => '+923000000101',
                'delivery_address' => $fulfillment === 'delivery' ? 'House 12, Block C, Gulberg' : null,
                'latitude' => $shop->latitude, 'longitude' => $shop->longitude,
                'subtotal' => $subtotal, 'delivery_fee' => $fee,
                'total' => round($subtotal + $fee, 2), 'placed_at' => $placedAt,
            ]);
            $order->items()->create([
                'tenant_id' => $shop->id, 'product_id' => $product->id,
                'product_name' => $product->name, 'quantity' => $qty,
                'unit_price' => $unit, 'line_total' => $subtotal,
            ]);
        }
    }

    private function seedAnnouncements(): void
    {
        if (Announcement::query()->exists()) {
            return;
        }
        Announcement::query()->create([
            'title' => 'Welcome to ShopOS! 🎉',
            'body' => 'Order from your favorite local shops — cash on delivery, no fuss.',
            'audience' => 'customers', 'is_published' => true, 'published_at' => now()->subDay(),
            'recipients_count' => 10,
        ]);
        Announcement::query()->create([
            'title' => 'Eid timings', 'body' => 'Most shops run special hours during Eid week.',
            'audience' => 'all',
        ]);
    }
}
