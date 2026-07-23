<?php

namespace App\Http\Requests\Admin;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AnnouncementRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::ANNOUNCEMENTS_MANAGE);
    }

    public function rules(): array
    {
        $creating = $this->route('announcement') === null;

        return [
            'title' => [$creating ? 'required' : 'sometimes', 'string', 'max:120'],
            'body' => [$creating ? 'required' : 'sometimes', 'string', 'max:1000'],
            'audience' => ['sometimes', Rule::in(['tenants', 'customers', 'all'])],
            'link' => ['nullable', 'string', 'max:500'],
            'image' => ['nullable', 'image', 'mimes:jpg,jpeg,png,webp', 'max:4096'],
        ];
    }
}
