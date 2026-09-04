<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * A STRANGER IS TOLD THEY ARE A STRANGER — WHATEVER HEADERS THEY SENT.
 *
 * Found on the live box during the 2026-09-04 QA run, and reproduced here.
 *
 * Laravel's `Authenticate` middleware, given an unauthenticated request it does
 * not believe wants JSON, redirects to a route named `login`. This app has no
 * such route — it is an API with a separate SPA — so the redirect threw
 * `RouteNotFoundException` and the caller got a **500**.
 *
 *     Accept: application/json  → 401   the panel always sends this
 *     no Accept header          → 500   everything else
 *
 * That is why no shop ever hit it and why it sat there anyway: a URL pasted
 * into a browser bar, a curl in a runbook, an uptime probe, a mobile client
 * that forgets the header. Every one of them was told "Something went wrong.
 * Please try again." for the single condition the API can state exactly — you
 * are not signed in — and every one of them logged a 500 against a healthy
 * server.
 *
 * These tests send NO Accept header on purpose. `getJson()` would set one and
 * would have passed against the bug, which is precisely how it survived.
 */
class UnauthenticatedIsRefusedTest extends TestCase
{
    use RefreshDatabase;

    /**
     * A few doors, deliberately of different shapes: a plain tenant list, one
     * behind a module gate, and one behind a role. Whichever middleware turns
     * a stranger away first, the ANSWER has to be the same.
     *
     * @return array<string, array{0: string}>
     */
    public static function doors(): array
    {
        return [
            'a tenant list' => ['/api/v1/products'],
            'the till' => ['/api/v1/sales'],
            'behind a module gate' => ['/api/v1/fuel/tanks'],
            'the platform console' => ['/api/v1/admin/tenants'],
        ];
    }

    #[DataProvider('doors')]
    public function test_a_stranger_with_no_accept_header_is_told_to_sign_in(string $path): void
    {
        $response = $this->get($path);

        $this->assertSame(
            401,
            $response->getStatusCode(),
            "{$path} answered {$response->getStatusCode()} to a request with no Accept header. "
            .'An API must refuse a stranger, never redirect one to a login page it does not have.',
        );
    }

    #[DataProvider('doors')]
    public function test_the_refusal_is_the_same_when_json_is_asked_for(string $path): void
    {
        // The half that already worked, kept so a fix to the other half cannot
        // quietly break this one.
        $this->getJson($path)->assertStatus(401);
    }

    public function test_an_expired_or_invented_token_is_also_a_refusal_and_not_a_crash(): void
    {
        // A token that has run out is the commonest way a real client arrives
        // unauthenticated, and it took the same 500 path.
        $response = $this->withToken('999|thistokenneverexisted')->get('/api/v1/products');

        $this->assertSame(401, $response->getStatusCode());
    }

    public function test_the_refusal_says_so_in_the_api_envelope(): void
    {
        // Not just the status. A client reads `message`; "Something went wrong.
        // Please try again." sends a cashier to look for a fault that is not
        // there, when the honest answer is "sign in again".
        $body = $this->get('/api/v1/products')->json();

        $this->assertFalse($body['success'] ?? true);
        $this->assertNotSame('Something went wrong. Please try again.', $body['message'] ?? null);
    }
}
