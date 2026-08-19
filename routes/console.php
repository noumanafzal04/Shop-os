<?php

use App\Actions\Inventory\NotifyExpiringStock;
use App\Models\FuelPriceChange;
use App\Models\Product;
use App\Services\ReservationService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// No-show sweeper: expire overdue reservations and release their stock.
Artisan::command('reservations:expire', function (ReservationService $service) {
    $count = $service->expireOverdue();
    $this->info("Expired {$count} overdue reservation(s).");
})->purpose('Expire overdue reservations and release held stock');

Schedule::command('reservations:expire')->everyFiveMinutes();

/**
 * Rates that have fallen due.
 *
 * A price notification is entered the evening before and takes effect at
 * midnight. Recording it must not move the pumps — that was the bug: a station
 * that entered tomorrow's rate at 8pm sold the whole night at it.
 *
 * So a future rate sits unapplied until this runs. Every five minutes, like the
 * reservation sweeper: at worst the forecourt keeps last night's rate for five
 * minutes after midnight, which is a great deal better than charging tomorrow's
 * for four hours before it.
 *
 * Ordered by `effective_at` so two notifications logged out of order still land
 * in the order the government issued them, and the last one wins.
 */
Artisan::command('fuel:apply-rates', function (): void {
    $due = FuelPriceChange::query()
        ->withoutGlobalScopes()
        ->whereNull('applied_at')
        ->where('effective_at', '<=', now())
        ->orderBy('effective_at')
        ->get();

    foreach ($due as $change) {
        DB::transaction(function () use ($change): void {
            /** @var Product|null $product */
            $product = Product::query()->withoutGlobalScopes()
                ->whereKey($change->product_id)->lockForUpdate()->first();

            // The product may have been deleted since the notification was
            // logged. The rate stays in the history — it is a record of what
            // the government said — but there is nothing left to price.
            if ($product !== null) {
                $product->update(['price' => $change->new_price]);
            }

            $change->update(['applied_at' => now()]);
        });
    }

    $this->info("Applied {$due->count()} fuel rate(s).");
})->purpose('Apply fuel price notifications that have reached their effective time');

Schedule::command('fuel:apply-rates')->everyFiveMinutes();

/**
 * Stock that is about to stop being money.
 *
 * Expiry is the only loss in a shop that is completely silent: nothing breaks,
 * no figure looks wrong, and the stock sits on the shelf looking like stock.
 * Every part of the answer already existed — batches carry dates, the dashboard
 * counts them, Disposals records where they went — and all of it was PULL-only,
 * so a shop found out on the day somebody happened to look.
 *
 * Once a day, early, and once per lot per stage. See NotifyExpiringStock for
 * why it speaks exactly twice about any one lot rather than every morning.
 */
Artisan::command('stock:expiring', function (NotifyExpiringStock $action) {
    $sent = $action->run();

    $this->info("Expiry alerts sent — approaching: {$sent['approaching']}, expired: {$sent['expired']}.");
})->purpose('Alert shop owners about stock nearing or past its expiry date');

// 07:00: before the shutters go up, so the first decision of the day can be
// made about it rather than the last.
Schedule::command('stock:expiring')->dailyAt('07:00');
