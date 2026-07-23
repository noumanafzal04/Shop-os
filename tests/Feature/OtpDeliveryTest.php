<?php

namespace Tests\Feature;

use App\Enums\OtpPurpose;
use App\Models\AppNotification;
use App\Jobs\SendChannelNotification;
use App\Models\User;
use App\Services\EmailSender;
use App\Services\OtpService;
use App\Services\SmsSender;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class OtpDeliveryTest extends TestCase
{
    use RefreshDatabase;

    public function test_email_identifier_delivers_via_email_sender(): void
    {
        $this->mock(EmailSender::class, function ($m): void {
            $m->shouldReceive('send')->once()->withArgs(fn ($to) => $to === 'user@example.com');
        });
        $this->mock(SmsSender::class, fn ($m) => $m->shouldReceive('send')->never());

        app(OtpService::class)->request('user@example.com', OtpPurpose::Login);
    }

    public function test_phone_identifier_delivers_via_sms_sender(): void
    {
        $this->mock(SmsSender::class, function ($m): void {
            $m->shouldReceive('send')->once()->withArgs(fn ($to, $msg) => $to === '+923001234567' && str_contains($msg, 'ShopOS'));
        });
        $this->mock(EmailSender::class, fn ($m) => $m->shouldReceive('send')->never());

        app(OtpService::class)->request('+923001234567', OtpPurpose::Login);
    }

    public function test_sms_sender_posts_to_gateway_when_configured(): void
    {
        config(['services.sms.endpoint' => 'https://sms.test/send', 'services.sms.key' => 'k', 'services.sms.from' => 'ShopOS']);
        Http::fake(['sms.test/*' => Http::response(['ok' => true], 200)]);

        app(SmsSender::class)->send('+92300', 'hello');

        Http::assertSent(fn ($r) => str_contains($r->url(), 'sms.test') && $r['to'] === '+92300' && $r['message'] === 'hello');
    }

    public function test_sms_sender_no_http_when_unconfigured(): void
    {
        config(['services.sms.endpoint' => null, 'services.sms.key' => null]);
        Http::fake();
        app(SmsSender::class)->send('+92300', 'hi');
        Http::assertNothingSent();
    }

    public function test_notification_email_channel_sends_to_user_email(): void
    {
        $user = User::factory()->create(['email' => 'owner@shop.test']);
        $n = AppNotification::query()->create([
            'user_id' => $user->id, 'tenant_id' => $user->tenant_id,
            'type' => 'order.placed', 'title' => 'New order', 'body' => 'You have a new order', 'data' => [],
        ]);

        $this->mock(EmailSender::class, function ($m): void {
            $m->shouldReceive('send')->once()->withArgs(fn ($to, $subj) => $to === 'owner@shop.test' && $subj === 'New order');
        });

        (new SendChannelNotification($n->id, 'email'))->handle(
            app(\App\Services\FcmSender::class), app(SmsSender::class), app(EmailSender::class),
        );
    }
}
