<?php

use App\Actions\Inventory\NotifyExpiringStock;
use App\Services\ReservationService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
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
