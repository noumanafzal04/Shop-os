<?php

use App\Support\ApiResponse;
use App\Support\FrontDoor;
use Illuminate\Support\Facades\Route;

/*
 * THE API'S OWN ADDRESS, TYPED INTO A BROWSER.
 *
 * It answered with the framework's welcome page — "Deploy now", Laracasts, a
 * link to the documentation. On the live box that address is the one the
 * product is known by, so it is what a shopkeeper who was told the name saw
 * first.
 *
 * Somebody who arrives here wants the product: they are sent to the panel
 * when this install knows where it is (PANEL_URL, or the origin CORS already
 * names), and told plainly what this address is when it does not.
 */
Route::get('/', function () {
    $panel = FrontDoor::panelFrom(request()->getHost());

    return $panel !== null
        ? redirect()->away($panel)
        : ApiResponse::ok(['app' => config('app.name'), 'api' => url('/api/v1')], 'This is the API. The app is at another address.');
});
