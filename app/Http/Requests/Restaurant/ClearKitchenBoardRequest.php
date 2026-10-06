<?php

namespace App\Http\Requests\Restaurant;

use Illuminate\Foundation\Http\FormRequest;

class ClearKitchenBoardRequest extends FormRequest
{
    /** The route already gates on the pass's own permission; a second check here would only drift. */
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // Said, never assumed. A clear with no scope must not fall back to
            // "everything": that is tonight's whole queue gone on a typo.
            'scope' => ['required', 'in:older,board'],
            'station' => ['nullable', 'string', 'max:60'],
        ];
    }
}
