<?php

use App\Exceptions\DomainException;
use App\Http\Middleware\EnforceSubscription;
use App\Http\Middleware\EnsureFeature;
use App\Http\Middleware\EnsurePermission;
use App\Http\Middleware\EnsureRole;
use App\Http\Middleware\ResolveBranch;
use App\Http\Middleware\ResolveRegister;
use App\Http\Middleware\ResolveTenant;
use App\Support\ApiResponse;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Http\Middleware\CheckAbilities;
use Laravel\Sanctum\Http\Middleware\CheckForAnyAbility;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'tenant' => ResolveTenant::class,
            'branch' => ResolveBranch::class,
            'terminal' => ResolveRegister::class,
            'role' => EnsureRole::class,
            'permission' => EnsurePermission::class,
            'feature' => EnsureFeature::class,
            'subscription' => EnforceSubscription::class,
            'abilities' => CheckAbilities::class,
            'ability' => CheckForAnyAbility::class,
        ]);

        /*
         * AN API NEVER REDIRECTS A STRANGER TO A LOGIN PAGE.
         *
         * Laravel's `Authenticate` middleware, given an unauthenticated request
         * it does not believe wants JSON, tries to redirect to a route named
         * `login`. This app has no such route — it is an API and a separate
         * SPA — so the redirect threw `RouteNotFoundException` and the request
         * came back **500**.
         *
         * Found on the live box, and reproduced locally:
         *
         *     GET /api/v1/products  Accept: application/json   → 401  ✅
         *     GET /api/v1/products  (no Accept header)         → 500  ✗
         *     GET /api/v1/products  Bearer <expired>           → 500  ✗
         *
         * The panel always sends the header, which is why no shop had hit it.
         * Everything else does: a URL pasted into a browser bar, a curl in a
         * runbook, an uptime probe, a mobile client that forgets. All of them
         * were told "Something went wrong. Please try again." for the one
         * condition the API can state precisely — *you are not signed in* — and
         * every one of them logged a 500 against a server that was fine.
         *
         * Returning null means "do not redirect", so the middleware throws
         * `AuthenticationException` and the renderable below turns it into the
         * 401 it always should have been.
         */
        $middleware->redirectGuestsTo(
            fn (Request $request) => $request->is('api/*') ? null : '/',
        );
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*'),
        );

        // Every API error uses the same envelope: {success,message,data,errors,meta}.
        $exceptions->renderable(function (DomainException $e, Request $request) {
            if ($request->is('api/*')) {
                return ApiResponse::error($e->getMessage(), $e->status, code: $e->errorCode);
            }
        });

        $exceptions->renderable(function (ValidationException $e, Request $request) {
            if ($request->is('api/*')) {
                return ApiResponse::validation($e->errors());
            }
        });

        $exceptions->renderable(function (AuthenticationException $e, Request $request) {
            if ($request->is('api/*')) {
                return ApiResponse::unauthorized();
            }
        });

        $exceptions->renderable(function (AuthorizationException $e, Request $request) {
            if ($request->is('api/*')) {
                return ApiResponse::forbidden($e->getMessage() ?: 'This action is forbidden.');
            }
        });

        $exceptions->renderable(function (ModelNotFoundException|NotFoundHttpException $e, Request $request) {
            if ($request->is('api/*')) {
                return ApiResponse::notFound();
            }
        });

        $exceptions->renderable(function (TooManyRequestsHttpException $e, Request $request) {
            if ($request->is('api/*')) {
                return ApiResponse::error('Too many requests. Please slow down.', 429, code: 'RATE_LIMITED');
            }
        });

        $exceptions->renderable(function (HttpException $e, Request $request) {
            if ($request->is('api/*')) {
                return ApiResponse::error($e->getMessage() ?: 'Request failed.', $e->getStatusCode());
            }
        });

        $exceptions->renderable(function (Throwable $e, Request $request) {
            if ($request->is('api/*') && ! config('app.debug')) {
                // Never leak internals in production responses.
                return ApiResponse::error('Something went wrong. Please try again.', 500, code: 'SERVER_ERROR');
            }
        });
    })->create();
