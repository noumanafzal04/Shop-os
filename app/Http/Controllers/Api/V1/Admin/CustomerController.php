<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Enums\OrderStatus;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * The platform's customers — the people who order from the shops.
 *
 * ── What was here ───────────────────────────────────────────────────────
 *
 * One method: `store`. Staff could make a customer's account and the screen
 * said "can sign in now" — and that was the last anybody saw of them. There
 * was no list, so an account just made could not be found, checked, corrected
 * or switched off. Reported as "customers are created but they do not show",
 * which was exactly true: nothing anywhere showed them.
 *
 * ── Whose these are ─────────────────────────────────────────────────────
 *
 * A customer here is a `users` row with the role `customer` — somebody who
 * signs in to the app and orders from any shop. It is NOT a shop's own
 * customer book (`customers`, one shop's khata), which belongs to that shop
 * and is none of the platform's business to list.
 *
 * Their orders are counted across every shop, straight from the table rather
 * than through the model: an order is fenced to the shop it was placed with,
 * and there is no shop in context here.
 */
class CustomerController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'status' => ['nullable', Rule::in(['active', 'suspended'])],
            'ordered' => ['nullable', Rule::in(['yes', 'never'])],
            'sort' => ['nullable', Rule::in(['newest', 'oldest', 'name', 'orders', 'spent'])],
        ]);

        $customers = $this->customers()
            ->select('users.*')
            ->selectSub($this->orders()->selectRaw('count(*)'), 'orders_count')
            ->selectSub($this->orders()->selectRaw('max(placed_at)'), 'last_order_at')
            ->selectSub(
                $this->orders()->where('status', OrderStatus::Completed->value)->selectRaw('coalesce(sum(total), 0)'),
                'spent',
            )
            ->when($request->query('search'), function (Builder $q, string $search): void {
                $q->where(function (Builder $q) use ($search): void {
                    $q->where('users.name', 'like', "%{$search}%")
                        ->orWhere('users.email', 'like', "%{$search}%")
                        ->orWhere('users.phone', 'like', "%{$search}%");
                });
            })
            ->when($request->query('status'), fn (Builder $q, string $status) => $q->where('users.status', $status))
            ->when($request->query('ordered') === 'yes', fn (Builder $q) => $q->whereExists($this->orders()->selectRaw('1')))
            ->when($request->query('ordered') === 'never', fn (Builder $q) => $q->whereNotExists($this->orders()->selectRaw('1')));

        match ($request->query('sort', 'newest')) {
            'oldest' => $customers->orderBy('users.created_at'),
            'name' => $customers->orderBy('users.name'),
            'orders' => $customers->orderByDesc('orders_count'),
            'spent' => $customers->orderByDesc('spent'),
            default => $customers->orderByDesc('users.created_at'),
        };

        $page = $customers->stably()->paginate(min((int) $request->query('per_page', 15), 100));
        $page->getCollection()->transform(fn (User $u) => $this->row($u));

        return ApiResponse::paginated($page);
    }

    /** The figures above the list. Counted, not read off whichever page is open. */
    public function summary(): JsonResponse
    {
        $all = $this->customers();

        return ApiResponse::ok([
            'total' => (clone $all)->count(),
            'active' => (clone $all)->where('status', UserStatus::Active)->count(),
            'suspended' => (clone $all)->where('status', UserStatus::Suspended)->count(),
            'new_this_month' => (clone $all)->where('created_at', '>=', now()->startOfMonth())->count(),
            'have_ordered' => (clone $all)->whereExists($this->orders()->selectRaw('1'))->count(),
        ]);
    }

    public function show(string $id): JsonResponse
    {
        $customer = $this->customers()
            ->select('users.*')
            ->selectSub($this->orders()->selectRaw('count(*)'), 'orders_count')
            ->selectSub($this->orders()->selectRaw('max(placed_at)'), 'last_order_at')
            ->selectSub(
                $this->orders()->where('status', OrderStatus::Completed->value)->selectRaw('coalesce(sum(total), 0)'),
                'spent',
            )
            ->findOrFail($id);

        $orders = DB::table('orders')
            ->join('tenants', 'tenants.id', '=', 'orders.tenant_id')
            ->where('orders.customer_id', $customer->id)
            ->orderByDesc('orders.placed_at')
            ->limit(10)
            ->get(['orders.id', 'orders.order_number', 'orders.status', 'orders.total', 'orders.placed_at', 'tenants.business_name as shop']);

        $addresses = DB::table('customer_addresses')
            ->where('user_id', $customer->id)
            ->orderByDesc('is_default')
            ->get(['id', 'label', 'address', 'is_default']);

        return ApiResponse::ok($this->row($customer) + [
            'recent_orders' => $orders->map(fn ($o) => [
                'id' => $o->id,
                'order_number' => $o->order_number,
                'shop' => $o->shop,
                'status' => $o->status,
                'total' => (float) $o->total,
                'placed_at' => $o->placed_at,
            ]),
            'addresses' => $addresses->map(fn ($a) => [
                'id' => $a->id,
                'label' => $a->label,
                'address' => $a->address,
                'is_default' => (bool) $a->is_default,
            ]),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'phone' => ['nullable', 'string', 'max:32', 'required_without:email', 'unique:users,phone'],
            'email' => ['nullable', 'email', 'max:255', 'required_without:phone', 'unique:users,email'],
            'password' => ['required', Password::min(8)],
        ]);

        $user = User::query()->create($data + [
            'role' => UserRole::Customer,
            'status' => UserStatus::Active,
            'email_verified_at' => now(),
        ]);

        return ApiResponse::created($this->row($user), "{$user->name} can sign in now");
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $customer = $this->customers()->findOrFail($id);

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32', Rule::unique('users', 'phone')->ignore($customer->id)],
            'email' => ['sometimes', 'nullable', 'email', 'max:255', Rule::unique('users', 'email')->ignore($customer->id)],
        ]);

        // They sign in with one or the other. Clearing both would leave an
        // account nobody — its owner included — can ever get into again.
        $phone = array_key_exists('phone', $data) ? $data['phone'] : $customer->phone;
        $email = array_key_exists('email', $data) ? $data['email'] : $customer->email;
        if (blank($phone) && blank($email)) {
            return ApiResponse::error('A customer needs a phone or an email to sign in with.', 422, [
                'phone' => ['Keep a phone or an email — they sign in with one of the two.'],
            ], 'VALIDATION_ERROR');
        }

        $customer->update($data);

        return ApiResponse::ok($this->row($customer->fresh()), 'Saved');
    }

    /** Switch the account off: it cannot sign in, and every session it has is ended. */
    public function suspend(string $id): JsonResponse
    {
        $customer = $this->customers()->findOrFail($id);
        $customer->update(['status' => UserStatus::Suspended]);
        $this->signOutEverywhere($customer);

        return ApiResponse::ok($this->row($customer->fresh()), "{$customer->name} can no longer sign in");
    }

    public function activate(string $id): JsonResponse
    {
        $customer = $this->customers()->findOrFail($id);
        $customer->update(['status' => UserStatus::Active]);

        return ApiResponse::ok($this->row($customer->fresh()), "{$customer->name} can sign in again");
    }

    /** A new password, typed by staff for somebody who has lost theirs. */
    public function resetPassword(Request $request, string $id): JsonResponse
    {
        $customer = $this->customers()->findOrFail($id);
        $data = $request->validate(['password' => ['required', Password::min(8)]]);

        $customer->forceFill(['password' => $data['password'], 'failed_login_attempts' => 0, 'locked_until' => null])->save();
        // Whoever was signed in with the old one is not any more.
        $this->signOutEverywhere($customer);

        return ApiResponse::ok($this->row($customer->fresh()), "Password set for {$customer->name}. They have been signed out everywhere.");
    }

    /**
     * Take away an account that should not exist — made with the wrong number,
     * made twice, made as a test.
     *
     * ONLY ONE THAT HAS NEVER ORDERED. An order belongs to its customer in the
     * database, and removing the customer removes the order with them: a shop
     * would lose a sale from its own history because the platform tidied up.
     * Somebody who has ordered is switched off, never removed.
     *
     * Removed outright rather than hidden, so the phone and the email are free
     * for the account that was meant to be made.
     */
    public function destroy(string $id): JsonResponse
    {
        $customer = $this->customers()->findOrFail($id);

        if (DB::table('orders')->where('customer_id', $customer->id)->exists()) {
            return ApiResponse::error(
                "{$customer->name} has ordered from a shop, and those orders are theirs. Switch the account off instead.",
                422,
                [],
                'CUSTOMER_HAS_ORDERS',
            );
        }

        $name = $customer->name;
        $this->signOutEverywhere($customer);
        $customer->forceDelete();

        return ApiResponse::ok(null, "{$name}'s account has been removed");
    }

    // ---------------------------------------------------------------

    /** Customers, and nobody else: this controller can never reach a shop's owner or staff. */
    private function customers(): Builder
    {
        return User::query()->where('users.role', UserRole::Customer);
    }

    /** One customer's orders, across every shop, for use inside the list query. */
    private function orders(): \Illuminate\Database\Query\Builder
    {
        return DB::table('orders')->whereColumn('orders.customer_id', 'users.id');
    }

    private function signOutEverywhere(User $user): void
    {
        PersonalAccessToken::query()
            ->where('tokenable_type', User::class)
            ->where('tokenable_id', $user->id)
            ->delete();
    }

    /** @return array<string, mixed> */
    private function row(User $u): array
    {
        return [
            'id' => $u->id,
            'name' => $u->name,
            'phone' => $u->phone,
            'email' => $u->email,
            'status' => $u->status instanceof UserStatus ? $u->status->value : (string) $u->status,
            'created_at' => $u->created_at?->toIso8601String(),
            'last_login_at' => $u->last_login_at?->toIso8601String(),
            'orders_count' => (int) ($u->orders_count ?? 0),
            'last_order_at' => $u->last_order_at ?? null,
            'spent' => round((float) ($u->spent ?? 0), 2),
        ];
    }
}
