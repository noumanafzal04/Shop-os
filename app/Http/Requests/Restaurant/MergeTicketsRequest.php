<?php

namespace App\Http\Requests\Restaurant;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class MergeTicketsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        return [
            // The tab being absorbed. The survivor is the one in the URL, so a
            // waiter always keeps the tab they are looking at.
            'source_ticket_id' => [
                'required', 'uuid',
                Rule::exists('restaurant_tickets', 'id')
                    ->where('tenant_id', $this->user()->tenant_id)
                    ->whereNull('deleted_at'),
            ],
        ];
    }
}
