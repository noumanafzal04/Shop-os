<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

class OtpLoginRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'identifier' => ['required', 'string', 'max:255'],
            'code' => ['required', 'digits:6'],
            'device_name' => ['sometimes', 'string', 'max:100'],
        ];
    }

    /**
     * Said in the words on the screen. Without these the sign-in said "The
     * identifier field is required." — the name of a field in the code.
     *
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'identifier.required' => 'Enter your email or phone number.',
            'code.required' => 'Enter the 6-digit code we sent you.',
            'code.digits' => 'The code is 6 digits.',
        ];
    }
}
