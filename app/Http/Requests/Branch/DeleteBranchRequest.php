<?php

namespace App\Http\Requests\Branch;

use App\Actions\Branch\EmptyPlaceAction;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Deleting a place, with what becomes of what is in it.
 *
 * Every field is optional: a place that is already empty needs none of them,
 * and one that is not is refused with the reason until they are given.
 */
class DeleteBranchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SETTINGS_MANAGE);
    }

    public function rules(): array
    {
        return [
            // Its stock: carried to another place, or written off with it.
            'stock' => ['nullable', Rule::in([EmptyPlaceAction::MOVE, EmptyPlaceAction::DISCARD])],
            'stock_to' => ['nullable', 'uuid', 'required_if:stock,'.EmptyPlaceAction::MOVE],
            // Where the people assigned to it work from now on.
            'people_to' => ['nullable', 'uuid'],
        ];
    }
}
