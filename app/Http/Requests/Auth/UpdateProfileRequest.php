<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Your own name, email and phone.
 *
 * Both contact fields are unique across users and both are nullable, so the
 * uniqueness rule has to IGNORE the person doing the editing — otherwise
 * saving a form with an unchanged email fails against that person's own row.
 */
class UpdateProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $id = $this->user()->id;

        return [
            'name' => ['required', 'string', 'min:2', 'max:255'],
            'email' => ['nullable', 'email', 'max:255', Rule::unique('users', 'email')->ignore($id)],
            'phone' => ['nullable', 'string', 'max:32', Rule::unique('users', 'phone')->ignore($id)],
        ];
    }

    public function messages(): array
    {
        return [
            'email.unique' => 'That email is already used by another account.',
            'phone.unique' => 'That phone number is already used by another account.',
        ];
    }
}
