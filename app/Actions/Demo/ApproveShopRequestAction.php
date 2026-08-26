<?php

namespace App\Actions\Demo;

use App\Models\AuditLog;
use App\Models\ShopRequest;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * The admin says yes: a demo becomes a real shop.
 *
 * CONVERTED, never recreated. Everything the visitor built — their products,
 * their prices, the sales they rang while trying it — lives in that tenant, and
 * handing them an empty new one at the moment they asked to stay would be the
 * worst possible reply.
 *
 * ── Three things change, and the third is the interesting one ───────────
 *
 *   `is_demo` / `demo_expires_at`  — it stops being temporary.
 *   `converted_at`                 — which door it came in through, kept on
 *                                    the shop so the admin list can find the
 *                                    newest owners without joining.
 *   `setup_completed` returns to FALSE.
 *
 * The owner's ACCOUNT is deliberately not touched. They set their own email and
 * password when they made the request — which is what lets them sign back into
 * their demo while they wait — so approving a shop sends nobody a password
 * through anything. An admin handing out credentials is a step this flow does
 * not need and should not acquire.
 *
 * That last one is the point. The demo skipped the setup wizard on purpose —
 * somebody who came to see a till should meet a till, not a form — and it was
 * handed a generated name like "Mart Demo K7QP". No real business is called
 * that. Putting the shop back through setup means the owner names their own
 * business, picks their city and drops their own pin, in the one place the app
 * already asks those questions.
 */
class ApproveShopRequestAction
{
    public function execute(User $admin, ShopRequest $request): ShopRequest
    {
        return DB::transaction(function () use ($admin, $request): ShopRequest {
            $tenant = $request->tenant()->firstOrFail();

            $tenant->forceFill([
                'is_demo' => false,
                'demo_expires_at' => null,
                // Their own business, named by them. See the note above.
                'setup_completed' => false,
                // WHICH DOOR THEY CAME IN THROUGH, kept on the shop itself.
                // This row is now the newest owner on the platform and the one
                // most worth a phone call; without this it would be
                // indistinguishable in the tenant list from a shop opened by
                // hand a year ago. See Tenant::origin().
                'converted_at' => now(),
            ])->save();

            $request->forceFill([
                'status' => ShopRequest::APPROVED,
                'reviewed_by' => $admin->id,
                'reviewed_at' => now(),
            ])->save();

            // Who turned a demo into a business, and when. A shop's own history
            // should start with the moment somebody decided it was one.
            AuditLog::query()->create([
                'user_id' => $admin->id,
                'tenant_id' => $tenant->id,
                'event' => 'demo_shop_approved',
                'auditable_type' => Tenant::class,
                'auditable_id' => $tenant->id,
                'old_values' => ['is_demo' => true],
                'new_values' => [
                    'is_demo' => false,
                    'requested_by' => $request->contact_email,
                    'setup_completed' => false,
                ],
                'ip_address' => request()?->ip(),
            ]);

            return $request->refresh();
        });
    }
}
