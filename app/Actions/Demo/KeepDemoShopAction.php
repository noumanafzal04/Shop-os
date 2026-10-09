<?php

namespace App\Actions\Demo;

use App\Enums\UserRole;
use App\Exceptions\DomainException;
use App\Models\AuditLog;
use App\Models\ShopRequest;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * THE ADMIN KEEPS A DEMO FOR ITS OWNER, there and then.
 *
 * ── Why a second way in ────────────────────────────────────────────────
 *
 * A demo could become a business in exactly one way: its visitor pressed
 * "Keep this shop", typed a contact and a password, and waited for an admin to
 * say yes. That is right for a stranger who found the landing page alone.
 *
 * It is the wrong way round for the commonest sale there is: somebody from the
 * platform SITTING WITH the shopkeeper, the demo open on the counter between
 * them, the shopkeeper saying "theek hai, yehi chahiye". The admin then had to
 * talk them through a form whose only purpose is to reach the admin — and
 * until they finished it, nothing on the admin side could touch the shop at
 * all. A demo nobody had "requested" was not even on a list.
 *
 * ── What the admin types, and why it is those things ───────────────────
 *
 * The owner's SIGN-IN. A demo is entered by a token and nothing else: the
 * account was opened with a throwaway address and a random password nobody
 * was ever told. A shop made real with that account is a shop its owner
 * cannot get back into tomorrow — so the name, the email and a password are
 * not optional here. They are the same four things "Keep this shop" asks.
 *
 * And, if they like, what the business is called. A demo is "Mart Demo
 * K7QP"; the setup wizard asks the name again anyway, but an admin who
 * already knows it should not have to leave a real shop sitting in the list
 * under a generated one.
 *
 * NOT the plan. Giving a shop a plan is recording what it paid, and that has
 * its own screen with its own arithmetic (the shop's page). A second, smaller
 * copy of it inside this dialog is how two of them start disagreeing.
 *
 * ── A request already waiting ──────────────────────────────────────────
 *
 * If the owner HAD pressed "Keep this shop" and it is still unanswered, this
 * answers it — approved, by this admin. Otherwise the queue would go on
 * showing somebody "waiting" for a shop they already have.
 */
class KeepDemoShopAction
{
    /**
     * @param  array{owner_name: string, owner_email: string, owner_phone?: string|null,
     *               password: string, business_name?: string|null}  $data
     */
    public function execute(User $admin, Tenant $tenant, array $data): Tenant
    {
        if (! $tenant->is_demo) {
            throw DomainException::unprocessable(
                'This is already a real shop.',
                'NOT_A_DEMO',
            );
        }

        return DB::transaction(function () use ($admin, $tenant, $data): Tenant {
            /** @var User $owner */
            $owner = $tenant->users()
                ->where('role', UserRole::ShopOwner)
                ->oldest()
                ->firstOrFail();

            // The account becomes somebody's. Until this line nobody on earth
            // could sign in to it.
            $owner->forceFill([
                'name' => $data['owner_name'],
                'email' => $data['owner_email'],
                'phone' => ($data['owner_phone'] ?? null) ?: $owner->phone,
                'password' => Hash::make($data['password']),
            ])->save();

            $wasCalled = $tenant->business_name;
            $name = trim((string) ($data['business_name'] ?? ''));
            if ($name !== '') {
                $tenant->forceFill(['business_name' => $name])->save();
            }

            $tenant->becomeABusiness();

            // Anybody waiting on an answer about THIS shop has it now.
            ShopRequest::query()
                ->where('tenant_id', $tenant->id)
                ->pending()
                ->update([
                    'status' => ShopRequest::APPROVED,
                    'reviewed_by' => $admin->id,
                    'reviewed_at' => now(),
                ]);

            // Who turned a demo into a business, and when — and that it was
            // done FOR the owner rather than asked for by them, which is the
            // difference somebody reading the trail later will want.
            AuditLog::query()->create([
                'user_id' => $admin->id,
                'tenant_id' => $tenant->id,
                'event' => 'demo_shop_kept_by_admin',
                'auditable_type' => Tenant::class,
                'auditable_id' => $tenant->id,
                'old_values' => ['is_demo' => true, 'business_name' => $wasCalled],
                'new_values' => [
                    'is_demo' => false,
                    'business_name' => $tenant->business_name,
                    'owner_email' => $data['owner_email'],
                    'setup_completed' => false,
                ],
                'ip_address' => request()?->ip(),
            ]);

            return $tenant->refresh();
        });
    }
}
