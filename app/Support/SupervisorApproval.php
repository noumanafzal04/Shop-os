<?php

namespace App\Support;

use App\Actions\Auth\EnsureUserCanAuthenticate;
use App\Exceptions\DomainException;
use App\Models\AuditLog;
use App\Models\CashSession;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;

/**
 * MONEY BACK OUT OF A DRAWER, WITH A SUPERVISOR'S YES.
 *
 * Tester pass 1 (B01): a supervisor with no shift refunded at a cashier's
 * counter; the notes left the cashier's drawer and no drawer counted them, so
 * the cashier closed short. The owner (2026-10-14): the refund leaves the
 * cashier's assigned drawer, a supervisor approves with their PIN, and the
 * approval, the amount, the cashier, the supervisor and the drawer are kept.
 * With no drawer at all it is never quietly put on someone else's.
 *
 * Two people need the yes:
 *  - whoever hands money back from a drawer that is not their own (named by
 *    `cash_session_id`) — a supervisor at their own device picking the
 *    cashier's drawer types THEIR OWN PIN;
 *  - whoever may ring a sale but not refund one (a cashier) — the supervisor
 *    types their PIN on the cashier's screen.
 * Anyone refunding from their own drawer with the permission needs nobody.
 */
final class SupervisorApproval
{
    /**
     * Who approved this refund, or null when the person needed nobody.
     *
     * @param  array{user_id?: string, pin?: string}|null  $approval
     */
    public static function forRefund(User $actor, ?string $sessionId, ?array $approval): ?User
    {
        $session = $sessionId === null ? null : CashSession::query()->find($sessionId);
        $foreign = $session !== null
            && $session->user_id !== $actor->id
            && $session->activeCover()?->user_id !== $actor->id;

        if (! $foreign && $actor->hasPermission(Permissions::SALES_REFUND)) {
            return null;
        }

        return self::verify($approval, Permissions::SALES_REFUND);
    }

    /**
     * The approver, proven by their PIN — the till's own PIN, its lockout and
     * the account guards (TillIdentityController::unlock), never a second kind.
     *
     * @param  array{user_id?: string, pin?: string}|null  $approval
     */
    public static function verify(?array $approval, string $permission): User
    {
        if (! is_array($approval) || empty($approval['user_id']) || ! isset($approval['pin'])) {
            throw DomainException::forbidden(
                'A supervisor has to approve this with their PIN.',
                'APPROVAL_REQUIRED',
            );
        }

        /** @var User|null $approver */
        $approver = User::query()
            ->where('tenant_id', app(TenantContext::class)->id())
            ->whereKey($approval['user_id'])
            ->first();

        if ($approver === null) {
            throw DomainException::unauthorized('That PIN is not right.');
        }
        if ($approver->isPinLocked()) {
            throw new DomainException('Too many wrong PINs. Try again in a few minutes.', 429, 'PIN_LOCKED');
        }

        app(EnsureUserCanAuthenticate::class)->execute($approver);

        if (! $approver->checkPin((string) $approval['pin'])) {
            throw DomainException::unauthorized('That PIN is not right.');
        }
        if (! $approver->hasPermission($permission)) {
            throw DomainException::forbidden("{$approver->name} cannot approve this — ask somebody who can hand money back.", 'APPROVER_CANNOT');
        }

        return $approver;
    }

    /** The trail: what was approved, how much, whose drawer, who rang it and who said yes. */
    public static function record(User $approver, User $actor, ?string $sessionId, Model $subject, float $amount, string $reference): void
    {
        $session = $sessionId === null ? null : CashSession::query()->with(['user:id,name', 'register:id,name'])->find($sessionId);

        AuditLog::query()->create([
            'user_id' => $approver->id,
            'tenant_id' => app(TenantContext::class)->id(),
            'event' => 'approved',
            'auditable_type' => $subject::class,
            'auditable_id' => $subject->getKey(),
            'old_values' => null,
            'new_values' => array_filter([
                'what' => $reference,
                'amount' => round($amount, 2),
                'approved_by' => $approver->name,
                'done_by' => $actor->name,
                'drawer_of' => $session?->user?->name,
                'drawer' => $session?->register?->name,
                'drawer_id' => $session?->id,
            ], fn ($v) => $v !== null),
            'ip_address' => request()?->ip(),
        ]);
    }
}
