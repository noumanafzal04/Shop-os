<?php

namespace App\Http\Requests\SaleDocument;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

class CancelSaleDocumentRequest extends FormRequest
{
    public function authorize(): bool
    {
        // Cancelling a QUOTATION moves nothing and needs only sales.manage.
        // Cancelling a LAYAWAY hands money back and puts stock on the shelf —
        // the same authority as a refund. The route enforces the split; this
        // is the floor.
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        return [
            'reason' => ['nullable', 'string', 'max:255'],
            // State one and the other is inferred; state both and they must add
            // up to what was paid. Omit both and the customer gets it all back.
            'refund_amount' => ['nullable', 'numeric', 'min:0'],
            'forfeit_amount' => ['nullable', 'numeric', 'min:0'],
            'refund_method' => ['nullable', 'in:cash,card,bank_transfer,other'],
        ];
    }
}
