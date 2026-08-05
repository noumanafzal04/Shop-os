<?php

namespace App\Http\Requests\Restaurant;

use Illuminate\Foundation\Http\FormRequest;

class BumpKitchenTicketRequest extends FormRequest
{
    /** The route already gates on sales.manage; a second check here would only drift. */
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // `fired` is absent on purpose: firing is what created the ticket,
            // so bumping back to it is never a legitimate move.
            'status' => ['required', 'in:preparing,ready,served'],
        ];
    }
}
