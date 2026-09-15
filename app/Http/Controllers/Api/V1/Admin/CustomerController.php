<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rules\Password;

/**
 * PEOPLE WHO SHOP, made by staff.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 *
 * A customer account could only ever be made by the customer, through
 * `/auth/register` on their own phone. That is the right default and it is not
 * the only case: somebody ringing the platform to place an order, a shopkeeper
 * setting up a regular who does not use apps, a tester who needs an account
 * that exists before the APK is installed. All of those ended in "ask them to
 * download it first", which is not an answer.
 *
 * ── What it deliberately is not ─────────────────────────────────────────
 *
 * There is no list, no edit and no delete here. This is a door, not a people
 * directory — a platform screen that could search and read every customer's
 * phone number is a different thing with a different argument behind it, and
 * nobody has asked for one. Adding the create alone keeps the blast radius the
 * size of the request.
 */
class CustomerController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            // One of the two. Login takes an `identifier` that is "email or
            // phone", so an account with neither can never be signed into —
            // and nothing would have said so until somebody tried.
            'phone' => ['nullable', 'string', 'max:32', 'required_without:email', 'unique:users,phone'],
            'email' => ['nullable', 'email', 'max:255', 'required_without:phone', 'unique:users,email'],
            'password' => ['required', Password::min(8)],
        ]);

        $user = User::query()->create($data + [
            'role' => UserRole::Customer,
            'status' => UserStatus::Active,
            // Staff typed these from the person in front of them, which is a
            // stronger check than an email round trip they will never make.
            'email_verified_at' => now(),
        ]);

        return ApiResponse::created([
            'id' => $user->id,
            'name' => $user->name,
            'phone' => $user->phone,
            'email' => $user->email,
        ], "{$user->name} can sign in now");
    }
}
