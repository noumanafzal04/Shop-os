<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * THE API'S OWN ADDRESS, TYPED INTO A BROWSER.
 *
 * Found by looking at the live box from outside: the address the product is
 * known by answered with the framework's welcome page — "Deploy now",
 * Laracasts, a link to the documentation — under the product's previous name.
 * The only test of that address was the framework's own example, which
 * asserted a 200 and was satisfied.
 *
 * Somebody who arrives there wants the product. They are sent to the panel
 * when the install knows where it is, and told what the address is when it
 * does not — never shown somebody else's page.
 */
class TheApisOwnAddressTest extends TestCase
{
    public function test_a_visitor_is_sent_to_the_panel_when_the_install_knows_where_it_is(): void
    {
        config(['app.panel_url' => 'https://panel.example.shop/']);

        $this->get('/')->assertRedirect('https://panel.example.shop');
    }

    public function test_the_panels_origin_is_known_from_cors_when_nobody_said_it_twice(): void
    {
        // CORS_ALLOWED_ORIGINS is the panel's own origin — the one a live box
        // must set anyway. It should not have to be typed a second time.
        config(['app.panel_url' => null, 'cors.allowed_origins' => ['https://panel.example.shop', 'https://other.example.shop']]);

        $this->get('/')->assertRedirect('https://panel.example.shop');
    }

    public function test_an_install_that_knows_neither_says_what_it_is_and_nothing_else(): void
    {
        config(['app.panel_url' => null, 'cors.allowed_origins' => ['*']]);

        $page = $this->get('/');

        $page->assertOk()->assertJsonPath('success', true)->assertJsonPath('data.app', config('app.name'));
        $this->assertStringEndsWith('/api/v1', (string) $page->json('data.api'));
        // The framework's page is gone — from the answer and from the disk.
        $this->assertStringNotContainsStringIgnoringCase('laracasts', (string) $page->getContent());
        $this->assertFileDoesNotExist(resource_path('views/welcome.blade.php'));
    }

    public function test_a_panel_at_this_very_address_is_not_a_redirect_to_itself(): void
    {
        // One origin, split by path at nginx: `/` is the panel's and never
        // reaches PHP. If it does reach PHP, sending it back to `/` is a loop.
        config(['app.panel_url' => 'http://localhost']);

        $this->get('http://localhost/')->assertOk()->assertJsonPath('data.app', config('app.name'));
    }
}
