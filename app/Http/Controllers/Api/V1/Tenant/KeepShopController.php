<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Models\ShopRequest;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

/**
 * "Keep this shop" — the one place a demo asks to become a business.
 *
 * Asked on the way OUT, never on the way in. A shopkeeper will not fill in a
 * form to LOOK at a till, and the ones who would type an email before seeing
 * anything mostly type a false one. By the time somebody presses this they
 * have put their own products in and rung a sale, so the address they give is
 * worth something to both sides.
 *
 * It asks for a contact and for THEIR OWN sign-in — an email and a password
 * they choose. Until this moment a demo owner cannot sign in at all: the
 * account was opened with a throwaway address and a random password nobody was
 * ever told, so closing the tab lost them the shop before its own clock ran
 * out. Setting them here means they can come back tonight, and that approval
 * needs no password sent to anybody through anything.
 *
 * It does NOT ask the shop's name, city or address. The setup wizard asks
 * those after approval — the app already has that form, and asking the same
 * questions twice is how two answers start disagreeing.
 */
class KeepShopController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $tenant = $request->user()->tenant;

        if ($tenant === null || ! $tenant->is_demo) {
            throw DomainException::unprocessable(
                'This is already your own shop.',
                'NOT_A_DEMO',
            );
        }

        $owner = $request->user();

        $data = $request->validate([
            'contact_name' => ['required', 'string', 'max:120'],
            // Unique across users, because it becomes this owner's sign-in.
            // Named explicitly so the message is about an email already in
            // use rather than a database constraint nobody can read.
            'contact_email' => [
                'required', 'email', 'max:190',
                Rule::unique('users', 'email')->ignore($owner->id),
            ],
            'contact_phone' => ['nullable', 'string', 'max:40'],
            // THEIR OWN CREDENTIALS, set here and not by an admin later.
            //
            // A demo owner cannot sign in at all until this: the account was
            // opened with a throwaway address and a random password nobody was
            // ever told, so closing the tab used to lose them the shop before
            // its own clock even ran out. Setting these now means they can come
            // back to their demo tonight, and that the moment the admin
            // approves they are already able to get in — with no password
            // being sent to anybody through anything.
            'password' => ['required', 'string', Password::min(8)],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        // ONE OPEN REQUEST PER SHOP. Pressing twice is somebody being unsure,
        // not a second business — and two rows would give the admin two things
        // to answer about one shop. Returned as a success rather than an error:
        // from where they are standing, "we have your request" is true.
        $existing = ShopRequest::query()->where('tenant_id', $tenant->id)->pending()->first();
        if ($existing !== null) {
            return ApiResponse::ok($existing, 'We already have your request — a reply is coming.');
        }

        $created = DB::transaction(function () use ($data, $tenant, $owner): ShopRequest {
            // The account becomes theirs immediately, whatever the admin later
            // decides. If the request is declined the shop still ends when its
            // demo clock says so — but until then it is a shop they can get
            // back into, which it was not five minutes ago.
            $owner->forceFill([
                'name' => $data['contact_name'],
                'email' => $data['contact_email'],
                // `??` first: the field is optional, so an absent key is not
                //  an empty one, and `$data['contact_phone']` alone threw.
                'phone' => ($data['contact_phone'] ?? null) ?: $owner->phone,
                'password' => Hash::make($data['password']),
            ])->save();

            return ShopRequest::query()->create([
                'tenant_id' => $tenant->id,
                'contact_name' => $data['contact_name'],
                'contact_email' => $data['contact_email'],
                'contact_phone' => $data['contact_phone'] ?? null,
                'note' => $data['note'] ?? null,
                'status' => ShopRequest::PENDING,
                'requested_at' => now(),
            ]);
        });

        return ApiResponse::created($created, 'Request sent — we will be in touch.');
    }

    /** What the banner needs to know: is somebody already waiting on an answer? */
    public function show(Request $request): JsonResponse
    {
        $tenant = $request->user()->tenant;

        return ApiResponse::ok(
            $tenant === null ? null : ShopRequest::query()->where('tenant_id', $tenant->id)->pending()->first(),
        );
    }
}
