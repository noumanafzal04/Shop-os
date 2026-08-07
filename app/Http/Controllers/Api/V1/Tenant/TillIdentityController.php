<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Auth\EnsureUserCanAuthenticate;
use App\Actions\Auth\IssueTokensAction;
use App\Actions\Pos\ReliefCoverAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\CashSession;
use App\Models\User;
use App\Rules\TillPin;
use App\Support\ApiResponse;
use App\Support\Permissions;
use App\Support\RegisterContext;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

/**
 * Who is standing at the till.
 *
 * Every sale, void, discount and drawer count is stamped with the signed-in
 * user, and on a shared terminal that stamp is a lie by mid-morning: whoever
 * opened up owns the whole day. The control that fixes it has to be faster
 * than a password or the counter will simply not use it — hence a PIN, scoped
 * so tightly (see the add_till_pins migration) that its weakness never leaves
 * the shop floor.
 */
class TillIdentityController extends Controller
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly EnsureUserCanAuthenticate $guards,
        private readonly IssueTokensAction $issueTokens,
        private readonly RegisterContext $register,
    ) {}

    /**
     * The roster: who can take this till, and who has a PIN to do it with.
     *
     * No secrets here — the lock screen needs faces and names to be usable,
     * and knowing that "Ayesha works here" is not information the counter is
     * keeping from anyone standing in front of it.
     */
    public function roster(): JsonResponse
    {
        $users = User::query()
            ->where('tenant_id', $this->tenant->id())
            ->whereIn('role', ['shop_owner', 'staff'])
            ->where('status', 'active')
            ->orderBy('name')
            ->get()
            ->filter(fn (User $u) => $u->hasPermission(Permissions::SALES_MANAGE))
            ->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'role' => $u->role->value,
                'has_pin' => $u->hasPin(),
                // Shown so a locked-out cashier is told why, not left guessing.
                'pin_locked' => $u->isPinLocked(),
            ])
            ->values();

        return ApiResponse::ok($users);
    }

    /**
     * Unlock the till, or hand it to someone else.
     *
     * Same user  → the PIN is checked and nothing else changes; the device
     *              keeps the session it already had.
     * Other user → new tokens for them, and the outgoing cashier's session on
     *              THIS device is destroyed. A handover has to end the old
     *              session or the stamp on the next sale means nothing.
     */
    public function unlock(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['required', 'uuid'],
            'pin' => ['required', 'string'],
        ]);

        $current = $request->user();

        /** @var User|null $target */
        $target = User::query()
            ->where('tenant_id', $this->tenant->id())
            ->whereKey($data['user_id'])
            ->first();

        // Unknown id and wrong PIN answer identically: the roster is public to
        // the counter, but which ids are real should not be probeable.
        if ($target === null) {
            throw DomainException::unauthorized('That PIN is not right.');
        }

        if ($target->isPinLocked()) {
            throw new DomainException(
                'Too many wrong PINs. Try again in a few minutes, or sign in with a password.',
                429,
                'PIN_LOCKED',
            );
        }

        $this->guards->execute($target);

        if (! $target->checkPin($data['pin'])) {
            throw DomainException::unauthorized('That PIN is not right.');
        }

        if (! $target->hasPermission(Permissions::SALES_MANAGE)) {
            throw DomainException::forbidden('This account cannot operate the till.', 'NOT_A_TILL_USER');
        }

        // The cashier is back. Unlocking with their own PIN is the gesture that
        // says so, and it is the only one the counter will reliably make — a
        // reliever who has to remember to "hand the till back" will sometimes
        // not, and the next sale would carry the wrong name.
        $ended = $this->coverEndedFor($target);

        // Unlocking as yourself: nothing to re-issue.
        if ($target->id === $current->id) {
            return ApiResponse::ok([
                'user' => (new UserResource($target->load('tenant.city', 'tenant.plan')))->resolve(),
                'switched' => false,
                'cover_ended' => $ended,
            ], 'Unlocked');
        }

        $tokens = $this->issueTokens->execute($target, 'till');

        // End the outgoing session on this device — after the new one exists,
        // so a failure here never strands the till without either.
        $outgoing = $current->currentAccessToken();
        if ($outgoing !== null) {
            $current->tokens()
                ->whereIn('name', [$outgoing->name, $outgoing->name.':refresh'])
                ->delete();
        }

        $target->forceFill(['last_login_at' => now()])->save();

        return ApiResponse::ok([
            'user' => (new UserResource($target->load('tenant.city', 'tenant.plan')))->resolve(),
            'switched' => true,
            'cover_ended' => $ended,
            // This lane has an open drawer that isn't theirs — so the POS can
            // offer "cover this till" instead of the dead end the incoming
            // cashier would otherwise hit (REGISTER_BUSY, and no way forward).
            'cover_available' => $this->coverAvailableFor($target),
            ...$tokens,
        ], "{$target->name} is now on this till");
    }

    /**
     * End whatever cover is running on this user's own drawer. Returns true
     * only when there was one to end, so the till can say "you're back on your
     * own drawer" rather than announcing nothing.
     */
    private function coverEndedFor(User $target): bool
    {
        $mine = CashSession::query()
            ->where('user_id', $target->id)
            ->where('status', 'open')
            ->first();

        if ($mine === null) {
            return false;
        }

        return app(ReliefCoverAction::class)->endFor($mine, $target) !== null;
    }

    /**
     * A drawer on this terminal that belongs to somebody else and is not
     * already being covered — i.e. an offer this user could take up.
     *
     * @return array<string, mixed>|null
     */
    private function coverAvailableFor(User $target): ?array
    {
        $session = $this->register->get()?->openSession();

        if ($session === null || $session->user_id === $target->id) {
            return null;
        }

        // Someone with a drawer of their own cannot cover — don't offer it.
        $holdsOwn = CashSession::query()
            ->where('user_id', $target->id)
            ->where('status', 'open')
            ->exists();

        if ($holdsOwn || $session->activeCover() !== null) {
            return null;
        }

        return [
            'session_id' => $session->id,
            'cashier_name' => $session->user?->name,
        ];
    }

    /** Set or change your own till PIN. Your password is the proof it's you. */
    public function setOwnPin(Request $request): JsonResponse
    {
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'pin' => ['required', new TillPin],
        ]);

        $user = $request->user();

        if (! Hash::check($data['current_password'], $user->password)) {
            throw DomainException::unauthorized('That password is not right.');
        }

        $user->setPin($data['pin']);

        return ApiResponse::ok(null, 'Till PIN set');
    }

    public function clearOwnPin(Request $request): JsonResponse
    {
        $request->user()->clearPin();

        return ApiResponse::ok(null, 'Till PIN removed');
    }

    /**
     * An owner setting a staff member's PIN — the realistic path, since a new
     * cashier is handed one on their first shift. Owners can already reset a
     * password, so this grants nothing new; it is just faster.
     */
    public function setStaffPin(Request $request, string $staffId): JsonResponse
    {
        $data = $request->validate(['pin' => ['required', new TillPin]]);

        $staff = $this->tenantStaff($staffId);
        $staff->setPin($data['pin']);

        return ApiResponse::ok(null, "Till PIN set for {$staff->name}");
    }

    public function clearStaffPin(string $staffId): JsonResponse
    {
        $staff = $this->tenantStaff($staffId);
        $staff->clearPin();

        return ApiResponse::ok(null, "Till PIN removed for {$staff->name}");
    }

    private function tenantStaff(string $id): User
    {
        return User::query()
            ->where('tenant_id', $this->tenant->id())
            ->whereIn('role', ['shop_owner', 'staff'])
            ->whereKey($id)
            ->firstOrFail();
    }
}
