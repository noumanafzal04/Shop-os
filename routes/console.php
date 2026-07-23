<?php

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
