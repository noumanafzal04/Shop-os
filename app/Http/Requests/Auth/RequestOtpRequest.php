<?php

namespace App\Http\Requests\Auth;

use App\Enums\OtpPurpose;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class RequestOtpRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'identifier' => ['required', 'string', 'max:255'],
            'purpose' => ['required', Rule::enum(OtpPurpose::class)],
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
        ];
    }
}
