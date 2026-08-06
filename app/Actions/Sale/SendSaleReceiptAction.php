<?php

namespace App\Actions\Sale;

use App\Models\Sale;
use App\Services\SmsSender;
use Illuminate\Support\Facades\Log;

/**
 * Sends a customer their sale receipt over SMS and/or email.
 *
 * ── DEFERRED (2026-07-31) ─────────────────────────────────────────────
 * SCAFFOLD ONLY — the actual SMS/email dispatch is COMMENTED OUT until we
 * have provider credentials/keys (SMS gateway + a mail provider). The message
 * is still composed and logged so the flow can be verified end-to-end in dev.
 *
 * To turn it on later:
 *   1. Set SMS_ENDPOINT / SMS_API_KEY / SMS_FROM (SmsSender already reads them)
 *      and the mail provider env, then uncomment the send blocks below.
 *   2. Wire it up: a POST /sales/{sale}/send-receipt endpoint for manual send,
 *      and (optionally) an auto-send after checkout gated on a
 *      `receipt_auto_send` shop setting — both were intentionally NOT added yet.
 *   3. Add feature tests (Http::fake for SMS, Mail::fake for email).
 * ──────────────────────────────────────────────────────────────────────
 */
class SendSaleReceiptAction
{
    public function __construct(private readonly SmsSender $sms) {}

    /**
     * @return array{sms: bool, email: bool} which channels were sent (both
     *                                       false while deferred — nothing is dispatched without credentials)
     */
    public function execute(Sale $sale): array
    {
        $sale->loadMissing('tenant', 'customer');
        $sent = ['sms' => false, 'email' => false];

        $phone = $sale->customer_phone ?: $sale->customer?->phone;
        $email = $sale->customer?->email;
        if (empty($phone) && empty($email)) {
            return $sent;
        }

        $shop = $sale->tenant?->business_name ?? 'Your shop';
        $symbol = (string) ($sale->tenant?->setting('currency_symbol', 'Rs') ?? 'Rs');
        $total = number_format((float) $sale->total, 2);
        $message = "{$shop}\nReceipt {$sale->invoice_number}\nTotal: {$symbol} {$total}\nThank you for your purchase!";

        // Deferred: log the intent instead of sending. Remove this log and
        // uncomment the blocks below once credentials are in place.
        Log::info('sale receipt (deferred — no SMS/email credentials)', [
            'sale' => $sale->id, 'phone' => $phone, 'email' => $email, 'message' => $message,
        ]);

        // if (! empty($phone)) {
        //     try {
        //         $this->sms->send($phone, $message);
        //         $sent['sms'] = true;
        //     } catch (\Throwable $e) {
        //         Log::warning('receipt sms failed', ['sale' => $sale->id, 'error' => $e->getMessage()]);
        //     }
        // }
        //
        // if (! empty($email)) {
        //     try {
        //         \Illuminate\Support\Facades\Mail::raw($message, function ($m) use ($email, $shop, $sale): void {
        //             $m->to($email)->subject("{$shop} — Receipt {$sale->invoice_number}");
        //         });
        //         $sent['email'] = true;
        //     } catch (\Throwable $e) {
        //         Log::warning('receipt email failed', ['sale' => $sale->id, 'error' => $e->getMessage()]);
        //     }
        // }

        return $sent;
    }
}
