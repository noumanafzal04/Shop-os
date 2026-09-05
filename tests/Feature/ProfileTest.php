<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Editing your own name and contact details.
 *
 * There was no way to do it at all: the app could READ a profile and never
 * change one, so a customer who mistyped their name at sign-up carried it for
 * ever, and a changed phone number could only be fixed by someone with
 * database access.
 */
class ProfileTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    public function withToken(string $token, string $type = 'Bearer'): static
    {
        $this->app['auth']->forgetGuards();

        return parent::withToken($token, $type);
    }

    private function customer(array $attrs = []): User
    {
        return User::factory()->create([
            'role' => UserRole::Customer,
            'tenant_id' => null,
            ...$attrs,
        ]);
    }

    private function tokenFor(User $user): string
    {
        return $user->createToken('test', ['access'])->plainTextToken;
    }

    public function test_a_customer_can_correct_their_own_name(): void
    {
        $user = $this->customer(['name' => 'Nomsn']);

        $res = $this->withToken($this->tokenFor($user))
            ->putJson('/api/v1/auth/profile', ['name' => 'Nouman Afzal']);

        $res->assertOk()->assertJsonPath('data.name', 'Nouman Afzal');
        $this->assertSame('Nouman Afzal', $user->fresh()->name);
    }

    public function test_saving_an_unchanged_email_is_not_a_duplicate_of_yourself(): void
    {
        // The uniqueness rule has to ignore the editor's own row, or the most
        // ordinary save there is — open the form, change the name, press
        // save — fails against the address the person already owns.
        $user = $this->customer(['email' => 'ayesha@example.com']);

        $this->withToken($this->tokenFor($user))
            ->putJson('/api/v1/auth/profile', [
                'name' => 'Ayesha K',
                'email' => 'ayesha@example.com',
            ])
            ->assertOk();
    }

    public function test_somebody_elses_email_is_refused(): void
    {
        $this->customer(['email' => 'taken@example.com']);
        $user = $this->customer(['email' => 'mine@example.com']);

        $this->withToken($this->tokenFor($user))
            ->putJson('/api/v1/auth/profile', [
                'name' => 'Whoever',
                'email' => 'taken@example.com',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('email');
    }

    public function test_changing_the_email_drops_its_verified_mark(): void
    {
        // `email_verified_at` says "we sent a code to THIS address and somebody
        // read it". Carrying the timestamp to a new address would mean the
        // system believes it verified one it has never contacted.
        $user = $this->customer([
            'email' => 'old@example.com',
            'email_verified_at' => now(),
        ]);

        $this->withToken($this->tokenFor($user))
            ->putJson('/api/v1/auth/profile', [
                'name' => $user->name,
                'email' => 'new@example.com',
            ])
            ->assertOk()
            ->assertJsonPath('data.email_verified', false);

        $this->assertNull($user->fresh()->email_verified_at);
    }

    public function test_an_unchanged_email_keeps_its_verified_mark(): void
    {
        $user = $this->customer([
            'email' => 'same@example.com',
            'email_verified_at' => now(),
        ]);

        $this->withToken($this->tokenFor($user))
            ->putJson('/api/v1/auth/profile', [
                'name' => 'New Name',
                'email' => 'same@example.com',
            ])
            ->assertOk()
            ->assertJsonPath('data.email_verified', true);
    }

    public function test_a_blank_name_is_refused(): void
    {
        $user = $this->customer();

        $this->withToken($this->tokenFor($user))
            ->putJson('/api/v1/auth/profile', ['name' => ''])
            ->assertStatus(422)
            ->assertJsonValidationErrors('name');
    }

    public function test_a_signed_out_visitor_cannot_edit_anybody(): void
    {
        $this->putJson('/api/v1/auth/profile', ['name' => 'Nobody'])
            ->assertStatus(401);
    }
}
