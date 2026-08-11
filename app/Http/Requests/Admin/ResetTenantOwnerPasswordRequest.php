<?php

namespace App\Http\Requests\Admin;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

class ResetTenantOwnerPasswordRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::TENANTS_RESET_PASSWORD);
    }

    public function rules(): array
    {
        return [
            // `confirmed` on purpose. The admin typing this is about to read it
            // down a phone line to a shopkeeper; a typo does not bounce back as
            // "wrong password" the way their own would — it locks the owner out
            // a second time, and neither of them knows why.
            'password' => ['required', 'confirmed', Password::min(8)],

            // Optional: only a business with more than one owner needs to say
            // which. The action refuses to guess rather than accepting this
            // silently, so the field is not `required_if` on anything the
            // client would have to work out for itself.
            'user_id' => ['nullable', 'uuid'],
        ];
    }

    public function messages(): array
    {
        return [
            'password.confirmed' => 'The two passwords do not match.',
        ];
    }
}
