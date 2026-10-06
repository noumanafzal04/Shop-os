<?php

namespace App\Http\Requests\Restaurant;

use Illuminate\Foundation\Http\FormRequest;

class UpdateTicketItemRequest extends FormRequest
{
    /** The route already gates on sales.manage; ownership is the controller's (assertMayWork). */
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // A STEP, never a target — see UpdateTicketItemAction. Bounded so
            // a slip of the thumb cannot order ten thousand of anything.
            'adjust' => ['sometimes', 'numeric', 'between:-1000,1000', 'not_in:0'],
            // Kitchen note ("no onions", "extra spicy"). Present-and-empty
            // clears it; absent leaves it alone.
            'note' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }

    /** Something has to be asked for. An empty body is a request that changes nothing and says it did. */
    public function withValidator($validator): void
    {
        $validator->after(function ($v): void {
            if (! $this->has('adjust') && ! $this->has('note')) {
                $v->errors()->add('adjust', 'Say what to change: the quantity, or the note.');
            }
        });
    }
}
