<?php

namespace App\Http\Requests\Pos;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Naming a till, from the office rather than from the till.
 *
 * `required` where registration's is `sometimes|nullable`, and the difference
 * is the whole point. A boot with no name must never wipe the name somebody
 * typed — so registration only writes what it actually sends. Here a name IS
 * what was asked for, and an empty one is a mistake worth refusing rather than
 * a way to quietly go back to "Unnamed till".
 */
class RenameDeviceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SETTINGS_MANAGE);
    }

    public function rules(): array
    {
        return [
            // 80 to match the registration rule — one column, one ceiling.
            'name' => ['required', 'string', 'max:80'],
        ];
    }

    public function messages(): array
    {
        return [
            'name.required' => 'Give this till a name — "Counter tablet", "Lane 2". It is how you will tell it from the others when something goes wrong on one of them.',
        ];
    }
}
